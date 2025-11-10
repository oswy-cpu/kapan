// MovePositionModal.tsx
// Modern, compact, square-corner redesign using your current stack (DaisyUI + Tailwind)
// – Square geometry (rounded-none)
// – Minimal elevation, clear borders/sections
// – Auto-closing dropdowns
// – Compact inputs & better visual rhythm
// – Preserves your hooks & logic

import { FC, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { FaGasPump } from "react-icons/fa";
import { FiAlertTriangle, FiChevronDown, FiChevronUp, FiX } from "react-icons/fi";
import { formatUnits } from "viem";
import { useAccount, useReadContract, useSwitchChain } from "wagmi";
import { CollateralSelector, CollateralWithAmount } from "~~/components/specific/collateral/CollateralSelector";
import { ERC20ABI, tokenNameToLogo } from "~~/contracts/externalContracts";
import { useKapanRouterV2 } from "~~/hooks/useKapanRouterV2";
import { useBatchingPreference } from "~~/hooks/useBatchingPreference";
import { useScaffoldReadContract } from "~~/hooks/scaffold-eth";
import { useDeployedContractInfo } from "~~/hooks/scaffold-eth/useDeployedContractInfo";
import { useCollateralSupport } from "~~/hooks/scaffold-eth/useCollateralSupport";
import { useCollaterals } from "~~/hooks/scaffold-eth/useCollaterals";
import { getProtocolLogo } from "~~/utils/protocol";
import { useTokenPriceApi } from "~~/hooks/useTokenPriceApi";

type FlashLoanProvider = {
  name: "Balancer V2" | "Balancer V3" | "Aave V3";
  icon: string;
  version: "v2" | "v3" | "aave";
  providerEnum: 0 | 1 | 2;
};

const ALL_FLASH_LOAN_PROVIDERS: FlashLoanProvider[] = [
  { name: "Balancer V2", icon: "/logos/balancer.svg", version: "v2", providerEnum: 0 },
  { name: "Balancer V3", icon: "/logos/balancer.svg", version: "v3", providerEnum: 1 },
  { name: "Aave V3", icon: "/logos/aave.svg", version: "aave", providerEnum: 2 },
] as const;

interface MovePositionModalProps {
  isOpen: boolean;
  onClose: () => void;
  fromProtocol: string;
  position: {
    name: string;
    balance: number;
    type: "supply" | "borrow";
    tokenAddress: string;
    decimals: number;
    tokenPrice?: bigint;
  };
  chainId?: number;
}

const BALANCER_CHAINS = [42161, 8453, 10];
const AAVE_CHAINS = [42161, 8453, 10, 59144];

// Health Factor thresholds
const HF_SAFE = 2.0;
const HF_RISK = 1.5;
const HF_DANGER = 1.1;

/**
 * Invisible helper to fetch a collateral's USD price via the API wrapper hook.
 * Reports the price back to parent as 8-decimal bigint. Never reads on-chain.
 */
const CollatPriceProbe: FC<{
  symbol?: string;
  address: string;
  onPrice: (address: string, price8d?: bigint) => void;
  enabled: boolean;
}> = ({ symbol, address, onPrice, enabled }) => {
  const sym = (symbol || "").trim();

  // Only call the hook if enabled and symbol exists
  const result = enabled && sym ? useTokenPriceApi(sym) : { isSuccess: false, price: undefined as number | undefined };

  useEffect(() => {
    if (!enabled || !sym) {
      return;
    }
    const priceNum = (result as any)?.price as number | undefined;
    const ok = (result as any)?.isSuccess && typeof priceNum === "number" && isFinite(priceNum) && priceNum > 0;
    if (ok) {
      onPrice(address.toLowerCase(), BigInt(Math.round(priceNum * 1e8)));
    }
    // If still loading or failed, do nothing; parent will treat as missing
  }, [enabled, sym, address, onPrice, (result as any)?.isSuccess, (result as any)?.price]);

  return null;
};

export const MovePositionModal: FC<MovePositionModalProps> = ({
  isOpen,
  onClose,
  fromProtocol,
  position,
  chainId,
}) => {
  const { address: userAddress, chain } = useAccount();
  const { switchChain } = useSwitchChain();

  const { createMoveBuilder, executeFlowBatchedIfPossible } = useKapanRouterV2();
  const { enabled: preferBatching, setEnabled: setPreferBatching, isLoaded: isPreferenceLoaded } = useBatchingPreference();
  const { data: routerContract } = useDeployedContractInfo({ contractName: "KapanRouter", chainId: chainId as any });

  // --- Modern minimal protocol choices (chips) ---
  const protocols = [{ name: "Aave V3" }, { name: "Compound V3" }, { name: "Venus" }];
  const availableProtocols = protocols.filter(p => p.name !== fromProtocol);
  const [destProtocol, setDestProtocol] = useState<string>(availableProtocols[0]?.name || "");

  // --- Auto-close dropdown state handling ---
  const [openFlash, setOpenFlash] = useState(false);
  const flashRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const onClickAway = (e: MouseEvent) => {
      if (!flashRef.current) return;
      if (!flashRef.current.contains(e.target as Node)) setOpenFlash(false);
    };
    document.addEventListener("mousedown", onClickAway);
    return () => document.removeEventListener("mousedown", onClickAway);
  }, []);

  // --- runtime state ---
  const [selectedCollats, setSelectedCollats] = useState<CollateralWithAmount[]>([]);
  const [amount, setAmount] = useState("");
  const [isMaxDebt, setIsMaxDebt] = useState(false);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [collateralOpen, setCollateralOpen] = useState(true);
  const [showAdvanced, setShowAdvanced] = useState(false);

  useEffect(() => {
    if (!isOpen || !chainId) return;
    if (chain?.id !== chainId) {
      try {
        switchChain?.({ chainId });
      } catch {}
    }
  }, [isOpen, chainId, chain?.id, switchChain]);

  // --- Flash availability (same logic, cleaner UI) ---
  const { data: balancerV2Enabled } = useReadContract({
    address: routerContract?.address as `0x${string}` | undefined,
    abi: routerContract?.abi,
    functionName: "balancerV2Enabled",
    query: { enabled: isOpen && !!chainId && !!routerContract?.address },
  });
  const { data: balancerV3Enabled } = useReadContract({
    address: routerContract?.address as `0x${string}` | undefined,
    abi: routerContract?.abi,
    functionName: "balancerV3Enabled",
    query: { enabled: isOpen && !!chainId && !!routerContract?.address },
  });
  const { data: aaveEnabled } = useReadContract({
    address: routerContract?.address as `0x${string}` | undefined,
    abi: routerContract?.abi,
    functionName: "aaveEnabled",
    query: { enabled: isOpen && !!chainId && !!routerContract?.address },
  });

  const availableFlash = useMemo(() => {
    const out: FlashLoanProvider[] = [];
    if (balancerV2Enabled && chainId && BALANCER_CHAINS.includes(chainId)) out.push(ALL_FLASH_LOAN_PROVIDERS[0]);
    if (balancerV3Enabled && chainId && BALANCER_CHAINS.includes(chainId)) out.push(ALL_FLASH_LOAN_PROVIDERS[1]);
    if (aaveEnabled && chainId && AAVE_CHAINS.includes(chainId)) out.push(ALL_FLASH_LOAN_PROVIDERS[2]);
    return out;
  }, [balancerV2Enabled, balancerV3Enabled, aaveEnabled, chainId]);

  const [flashProvider, setFlashProvider] = useState<FlashLoanProvider | null>(null);
  useEffect(() => {
    if (availableFlash.length === 0) setFlashProvider(null);
    else if (!flashProvider || !availableFlash.includes(flashProvider)) setFlashProvider(availableFlash[0]);
  }, [availableFlash, flashProvider]);

  // --- Collateral & prices ---
  const { collaterals: fetchedCollats, isLoading: isLoadingCollats } = useCollaterals(
    position.tokenAddress,
    fromProtocol,
    userAddress || "0x0000000000000000000000000000000000000000",
    isOpen
  );

  const collateralAddresses = useMemo(
    () => fetchedCollats.map((c: any) => c.address),
    // JSON stringify trick to update when list of addresses changes without deep deps
    [JSON.stringify(fetchedCollats.map((c: any) => c.address))]
  );

  const PROTOCOL_TO_GATEWAY: Record<string, "AaveGatewayView" | "CompoundGatewayView" | "VenusGatewayView"> = {
    aave: "AaveGatewayView",
    compound: "CompoundGatewayView",
    venus: "VenusGatewayView",
  };
  const normalizedFrom = fromProtocol.toLowerCase().replace(/\s+v\d+$/i, "").replace(/\s+/g, "");
  const gatewayContractName = PROTOCOL_TO_GATEWAY[normalizedFrom] || "AaveGatewayView";

  const { data: tokenBalance } = useScaffoldReadContract({
    contractName: gatewayContractName,
    functionName: "getBorrowBalance",
    args: [position.tokenAddress, userAddress || "0x0000000000000000000000000000000000000000"],
    query: { enabled: isOpen },
  });

  const { data: decimals } = useReadContract({
    address: position.tokenAddress as `0x${string}`,
    abi: ERC20ABI,
    functionName: "decimals",
    query: { enabled: isOpen },
  });

  // Borrow APRs (from & destination)
  const { data: fromBorrowRateData } = useScaffoldReadContract({
    contractName: gatewayContractName,
    functionName: "getBorrowRate",
    args: [position.tokenAddress],
    query: { enabled: isOpen },
  });

  const normalizedDest = destProtocol.toLowerCase().replace(/\s+v\d+$/i, "").replace(/\s+/g, "");
  const destGatewayContractName = PROTOCOL_TO_GATEWAY[normalizedDest] || "AaveGatewayView";

  const { data: destBorrowRateData } = useScaffoldReadContract({
    contractName: destGatewayContractName,
    functionName: "getBorrowRate",
    args: [position.tokenAddress],
    query: { enabled: isOpen && !!destProtocol },
  });

  const { isLoading: isLoadingSupport, supportedCollaterals } = useCollateralSupport(
    destProtocol,
    position.tokenAddress,
    collateralAddresses,
    isOpen
  );

  const collatsForSelector = useMemo(
    () =>
      fetchedCollats.map((c: any) => ({
        ...c,
        supported: supportedCollaterals[c.address] === true,
      })),
    [fetchedCollats, supportedCollaterals]
  );

  /**
   * Prices map (8 decimals) — API for collaterals ONLY, borrow price comes from props.
   * No on-chain price reads here.
   */
  const [tokenToPrices, setTokenToPrices] = useState<Record<string, bigint>>(() => {
    const map: Record<string, bigint> = {};
    if (position?.tokenAddress && position?.tokenPrice) {
      map[position.tokenAddress.toLowerCase()] = position.tokenPrice;
    }
    return map;
  });

  // Keep borrow token price in sync if props change
  useEffect(() => {
    if (position?.tokenAddress && position?.tokenPrice) {
      const addr = position.tokenAddress.toLowerCase();
      setTokenToPrices(prev => ({ ...prev, [addr]: position.tokenPrice as bigint }));
    }
  }, [position?.tokenAddress, position?.tokenPrice]);

  // Probe collateral prices via API (no on-chain) — one invisible probe per collateral.
  const apiProbes = useMemo(() => {
    if (!isOpen) return null;
    return collatsForSelector.map(c => {
      const addr = (c?.address || c?.token || "").toLowerCase();
      const symbol = (c?.symbol || c?.name || "").toString();
      return (
        <CollatPriceProbe
          key={addr || symbol}
          address={addr}
          symbol={symbol}
          enabled={!!addr && !!symbol}
          onPrice={(a, p8) => {
            if (!p8 || p8 <= 0n) return;
            setTokenToPrices(prev => {
              if (prev[a] === p8) return prev; // skip re-render if unchanged
              return { ...prev, [a]: p8 };
            });
          }}
        />
      );
    });
  }, [collatsForSelector, isOpen]);

  // Then keep using:
  const debtPrice = tokenToPrices[position.tokenAddress.toLowerCase()] ?? 0n;

  const debtUsd = useMemo(() => {
    const amt = parseFloat(amount || "0");
    const price = Number(formatUnits(debtPrice, 8));
    return amt * price;
  }, [amount, debtPrice]);

  const collatsUsd = useMemo(() => {
    return selectedCollats.reduce((sum, c) => {
      const addr = ((c as any).token || (c as any).address || "").toLowerCase();
      const p = tokenToPrices[addr];
      const normalized = Number(formatUnits(c.amount, c.decimals));
      const usd = p ? normalized * Number(formatUnits(p, 8)) : 0;
      return sum + usd;
    }, 0);
  }, [selectedCollats, tokenToPrices]);

  const remainingCollateralUsd = useMemo(() => {
    const total = collatsForSelector.reduce((sum, c) => {
      const selectedCollat = selectedCollats.find(sc => sc.token === c.address);
      const remaining = selectedCollat ? c.rawBalance - selectedCollat.amount : c.rawBalance;
      const addr = c.address.toLowerCase();
      const p = tokenToPrices[addr];
      const normalized = Number(formatUnits(remaining, c.decimals));
      const usd = p ? normalized * Number(formatUnits(p, 8)) : 0;
      return sum + usd;
    }, 0);
    return total;
  }, [collatsForSelector, selectedCollats, tokenToPrices]);

  const remainingDebtUsd = useMemo(() => {
    const currentTotalDebt = Math.abs(position.balance);
    const movingDebt = parseFloat(amount || "0");
    const remaining = currentTotalDebt - movingDebt;
    const price = Number(formatUnits(debtPrice, 8));
    return remaining * price;
  }, [position.balance, amount, debtPrice]);

  const getLtBps = (c: any): number => {
    const bps = Number(
      c?.liquidationThresholdBps ??
      c?.collateralFactorBps ??
      c?.ltBps ??
      c?.ltvBps ??
      8273
    );
    return Math.max(0, Math.min(10000, bps));
  };
  
  const price8 = (addr: string, tokenToPrices: Record<string, bigint>) =>
    tokenToPrices[addr.toLowerCase()] ?? 0n;
  
  const toUsd = (amount: bigint, decimals: number, p8: bigint): number => {
    if (!p8 || p8 === 0n || !amount) return 0;
    return Number(formatUnits(amount, decimals)) * Number(formatUnits(p8, 8));
  };
  
  /**
   * Compute HF = sum_i( collateral_i_usd * LT_i ) / total_debt_usd
   * - `all`            : full list of collaterals (e.g., collatsForSelector)
   * - `moved`          : array of selected collats to move (subtract from balances)
   * - `tokenToPrices`  : map of token address -> price (8d bigint)
   * - `totalDebtUsd`   : current or projected debt in USD
   */
  const computeHF = (
    all: any[],
    moved: { token?: string; address?: string; amount: bigint; decimals: number }[],
    tokenToPrices: Record<string, bigint>,
    totalDebtUsd: number
  ): number => {
    // Build addr -> movedAmount map
    const movedByAddr = new Map<string, bigint>();
    for (const m of moved || []) {
      const addr = ((m as any).token || (m as any).address || "").toLowerCase();
      if (!addr) continue;
      const prev = movedByAddr.get(addr) ?? 0n;
      movedByAddr.set(addr, prev + (m.amount ?? 0n));
    }
  
    let weightedCollUsd = 0;
  
    for (const c of all || []) {
      const addr = (c?.address || c?.token || "").toLowerCase();
      if (!addr) continue;
  
      const rawBal: bigint = c?.rawBalance ?? 0n;
      const decs: number = c?.decimals ?? 18;
      const lt = getLtBps(c) / 1e4; // 0..1
      if (lt <= 0) continue;
  
      // Subtract the portion we’re moving away
      const movedAmt = movedByAddr.get(addr) ?? 0n;
      const remaining = rawBal - movedAmt;
      if (remaining <= 0n) continue;
  
      const p8 = price8(addr, tokenToPrices);
      if (p8 === 0n) continue;
  
      const usd = toUsd(remaining, decs, p8);
      weightedCollUsd += usd * lt;
    }
  
    if (!isFinite(totalDebtUsd) || totalDebtUsd <= 0) return 999;
    return weightedCollUsd / totalDebtUsd;
  };  

  const currentDebtUsd = useMemo(() => {
    const price = Number(formatUnits(debtPrice, 8));
    return Math.abs(position.balance) * price;
  }, [position.balance, debtPrice]);

  const currentHF = useMemo(() => {
    return computeHF(
      collatsForSelector,         // all current collaterals
      [],                         // nothing moved yet
      tokenToPrices,              // prices (8d)
      currentDebtUsd              // current debt USD
    );
  }, [collatsForSelector, tokenToPrices, currentDebtUsd]);  

  const projectedHF = useMemo(() => {
    return computeHF(
      collatsForSelector,         // use same source list
      selectedCollats,            // subtract what we plan to move
      tokenToPrices,
      remainingDebtUsd            // your existing projected debt USD
    );
  }, [collatsForSelector, selectedCollats, tokenToPrices, remainingDebtUsd]);

  const hfTone = (hf: number) => {
    if (hf >= HF_SAFE) return { tone: "text-success", badge: "badge-success" };
    if (hf >= HF_RISK) return { tone: "text-warning", badge: "badge-warning" };
    if (hf >= HF_DANGER) return { tone: "text-error", badge: "badge-error" };
    return { tone: "text-error", badge: "badge-error" };
  };

  const fromBorrowRate = useMemo(() => {
    if (!fromBorrowRateData || !Array.isArray(fromBorrowRateData)) return undefined;
    return fromBorrowRateData[0] as bigint;
  }, [fromBorrowRateData]);

  const destBorrowRate = useMemo(() => {
    if (!destBorrowRateData || !Array.isArray(destBorrowRateData)) return undefined;
    return destBorrowRateData[0] as bigint;
  }, [destBorrowRateData]);

  const formatAPY = (rate: bigint | undefined): string => {
    if (!rate || rate === 0n) return "—";
    const rateNum = Number(rate);
    if (rateNum > 1e18) {
      const apy = Number(formatUnits(rate, 27)) * 100;
      return apy < 0.01 ? apy.toFixed(4) + "%" : apy.toFixed(2) + "%";
    }
    const secondsPerYear = 31536000;
    const apy = (rateNum / 1e18) * secondsPerYear * 100;
    return apy < 0.01 ? apy.toFixed(4) + "%" : apy.toFixed(2) + "%";
  };

  const apyDelta = useMemo(() => {
    if (!fromBorrowRate || !destBorrowRate) return null;
    const toPct = (r: bigint) => {
      const n = Number(r);
      if (n > 1e18) return Number(formatUnits(r, 27)) * 100;
      return (n / 1e18) * 31536000 * 100;
    };
    const fromP = toPct(fromBorrowRate);
    const toP = toPct(destBorrowRate);
    return { diff: fromP - toP, better: fromP > toP };
  }, [fromBorrowRate, destBorrowRate]);

  const fmt = (n: number, p = 2) =>
    Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: p, maximumFractionDigits: p });

  const onChangeCollats = useCallback((cs: CollateralWithAmount[]) => setSelectedCollats(cs), []);

  // Validation (minimal text, strong signal)
  const issues: string[] = [];
  if (position.type === "borrow") {
    if (selectedCollats.length === 0) issues.push("Select at least one collateral to move.");
    if (projectedHF < HF_DANGER) issues.push(`Health Factor after move: ${projectedHF.toFixed(2)} (liquidation risk).`);
    if (collatsUsd < debtUsd * 1.2) issues.push("Collateral value < 120% of debt to move.");
    selectedCollats.forEach(c => {
      if (!c.supported) issues.push(`${c.symbol} is not supported on the destination.`);
      if (c.amount === 0n) issues.push(`Amount for ${c.symbol} is zero.`);
    });
  }
  if (!amount || parseFloat(amount) === 0) issues.push("Enter debt amount.");

  const canConfirm = issues.length === 0 && !loading;

  const handleConfirm = async () => {
    try {
      setLoading(true);
      setErr(null);
      if (!userAddress) throw new Error("Connect your wallet.");
      if (!decimals) throw new Error("Token decimals not loaded.");
      if (!destProtocol) throw new Error("Select destination protocol.");
      if (position.type === "supply") throw new Error("Supply move not implemented yet.");
      if (!flashProvider) throw new Error("No flash loan provider available.");

      const builder = createMoveBuilder();
      const normSel = destProtocol.toLowerCase().replace(/\s+v\d+$/i, "").replace(/\s+/g, "");
      const normFrom = fromProtocol.toLowerCase().replace(/\s+v\d+$/i, "").replace(/\s+/g, "");
      if (normSel === "compound" || normFrom === "compound") {
        builder.setCompoundMarket(position.tokenAddress as `0x${string}`);
      }

      const debtStr = isMaxDebt
        ? formatUnits((tokenBalance || 0n) as bigint, (decimals as number) || position.decimals)
        : amount;
      const n = parseFloat(debtStr || "0");
      if (!debtStr || isNaN(n) || n <= 0) throw new Error("Invalid debt amount.");
      if (isMaxDebt && (!tokenBalance || tokenBalance === 0n)) throw new Error("No outstanding debt.");

      builder.buildUnlockDebt({
        fromProtocol,
        debtToken: position.tokenAddress as `0x${string}`,
        expectedDebt: debtStr,
        debtDecimals: (decimals as number) || position.decimals,
        flash: { version: flashProvider.version, premiumBps: 9, bufferBps: 10 },
      });

      for (const c of selectedCollats) {
        const isMax = c.amount === c.maxAmount;
        builder.buildMoveCollateral({
          fromProtocol,
          toProtocol: destProtocol,
          collateralToken: (c as any).token as `0x${string}`,
          withdraw: isMax ? { max: true } : { amount: formatUnits(c.amount, c.decimals) },
          collateralDecimals: c.decimals,
        });
      }

      builder.buildBorrow({
        mode: "coverFlash",
        toProtocol: destProtocol,
        token: position.tokenAddress as `0x${string}`,
        decimals: (decimals as number) || position.decimals,
        extraBps: 5,
        approveToRouter: true,
      });

      await executeFlowBatchedIfPossible(builder.build(), preferBatching);
      onClose();
    } catch (e: any) {
      setErr(e?.message || "Move failed.");
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  // --- UI ---
  const currentTone = hfTone(currentHF);
  const projectedTone = hfTone(projectedHF);

  return (
    <dialog open={isOpen} className="modal modal-open">
      <div className="modal-box max-w-[520px] md:max-w-[560px] w-full p-0 max-h-[85vh] flex flex-col rounded-none shadow-none border border-base-300">
      {/* HEADER */}
        <div className="sticky top-0 z-10 bg-base-100 border-b border-base-300 px-4 py-3">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-base tracking-tight">Move Position</h3>
            <button onClick={onClose} className="btn btn-ghost btn-sm btn-square rounded-none" disabled={loading}>
              <FiX className="w-5 h-5" />
            </button>
          </div>

          {/* Protocol rail (compact, square chips) */}
          <div className="mt-2 flex items-center gap-2 text-xs">
            <div className="flex items-center gap-1.5">
              <Image src={getProtocolLogo(fromProtocol)} alt={fromProtocol} width={16} height={16} />
              <span className="font-medium">{fromProtocol}</span>
              <span className="opacity-60">({formatAPY(fromBorrowRate)})</span>
            </div>
            <span className="opacity-40">→</span>
            <div className="flex gap-1.5">
              {availableProtocols.map(p => {
                const selected = destProtocol === p.name;
                return (
                  <button
                    key={p.name}
                    onClick={() => setDestProtocol(p.name)}
                    className={[
                      "px-3 py-1.5 text-xs border rounded-none",
                      selected ? "bg-primary text-primary-content border-primary" : "bg-base-100 border-base-300 hover:bg-base-200",
                    ].join(" ")}
                  >
                    <div className="flex items-center gap-1.5">
                      <Image src={getProtocolLogo(p.name)} alt={p.name} width={14} height={14} />
                      <span className="font-medium">{p.name}</span>
                      {selected && <span className="opacity-80">({formatAPY(destBorrowRate)})</span>}
                    </div>
                  </button>
                );
              })}
              {apyDelta && apyDelta.better && (
                <span className="ml-2 text-[10px] px-2 py-1 rounded-none border border-success/40 text-success bg-success/10">
                  Save {Math.abs(apyDelta.diff).toFixed(2)}% APR
                </span>
              )}
            </div>
          </div>
        </div>

        {/* CONTENT */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* Invisible API price probes for collaterals */}
          {apiProbes}

          {/* Health Factor banner (subtle, square) */}
          {position.type === "borrow" && currentHF < 999 && parseFloat(amount || "0") > 0 && selectedCollats.length > 0 && (
            <div className="border border-base-300 rounded-none p-3">
              <div className="flex items-start gap-2 text-xs">
                <FiAlertTriangle className="w-4 h-4 mt-[2px]" />
                <div className="flex-1">
                  <div className="font-medium">Health Factor Impact</div>
                  <div className="mt-1 flex items-center gap-2">
                    <span className={currentTone.tone}>Current: {currentHF >= 999 ? "∞" : currentHF.toFixed(2)}</span>
                    <span className="opacity-60">→</span>
                    <span className={projectedTone.tone}>
                      After: {projectedHF >= 999 ? "∞" : projectedHF.toFixed(2)}
                    </span>
                  </div>
                  {projectedHF < HF_DANGER && (
                    <div className="mt-1 text-error font-medium">Liquidation risk — reduce debt or add more collateral.</div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Debt amount input */}
          <section className="space-y-1">
            <label className="text-xs font-medium text-base-content/70">Debt Amount</label>
            <div className="relative">
              <input
                type="text"
                inputMode="decimal"
                className="input input-sm input-bordered w-full text-right rounded-none pr-28" // was pr-16
                placeholder="0.00"
                value={amount}
                onChange={e => {
                  setAmount(e.target.value);
                  setIsMaxDebt(false);
                }}
                disabled={loading}
              />
              {/* Fixed-width suffix to prevent overflow */}
              <div className="absolute inset-y-0 right-0 w-28 flex items-center justify-end gap-2 pr-2">
                <div className="flex items-center gap-1 text-[10px] opacity-70 shrink-0">
                  <span className="inline-flex w-3 h-3 overflow-hidden">
                    <Image
                      src={tokenNameToLogo(position.name)}
                      alt={position.name}
                      width={12}
                      height={12}
                      className="w-3 h-3 object-contain"
                    />
                  </span>
                  <span className="truncate max-w-[56px]">{position.name}</span>
                </div>
                <button
                  className="px-2 py-0.5 text-[10px] font-medium border rounded-none hover:bg-base-200 shrink-0"
                  onClick={() => {
                    const maxStr =
                      tokenBalance && decimals
                        ? formatUnits(tokenBalance as bigint, (decimals as number) || position.decimals)
                        : Math.abs(position.balance).toString();
                    setAmount(maxStr);
                    setIsMaxDebt(true);
                  }}
                  disabled={loading}
                >
                  MAX
                </button>
              </div>
            </div>
            <div className="flex justify-between text-[10px] opacity-60">
              <span>Max debt: {fmt(position.balance)}</span>
              <span>≈ ${fmt(debtUsd)}</span>
            </div>
          </section>

          {/* Flash loan (auto-close dropdown) */}
          {position.type === "borrow" && availableFlash.length > 0 && (
            <section>
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium text-base-content/70">Flash Loan Provider</label>
                <div ref={flashRef} className="relative">
                  <button
                    className="btn btn-xs rounded-none border-base-300 bg-base-100"
                    onClick={() => setOpenFlash(o => !o)}
                    type="button"
                  >
                    {flashProvider?.name ?? "Select"} <FiChevronDown className="w-3 h-3 ml-1" />
                  </button>
                  {openFlash && (
                    <ul className="absolute right-0 mt-1 w-44 border border-base-300 bg-base-100 rounded-none z-20">
                      {availableFlash.map(fp => (
                        <li key={fp.name}>
                          <button
                            type="button"
                            className="w-full text-left px-3 py-2 text-xs hover:bg-base-200"
                            onClick={() => {
                              setFlashProvider(fp);
                              setOpenFlash(false); // auto-close on select
                            }}
                          >
                            <div className="flex items-center gap-2">
                              <Image src={fp.icon} alt={fp.name} width={14} height={14} />
                              <span>{fp.name}</span>
                            </div>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </section>
          )}

          {/* Collateral selector */}
          {position.type === "borrow" && (
            <section>
              <button
                onClick={() => setCollateralOpen(o => !o)}
                className="w-full flex items-center justify-between text-xs font-medium text-base-content/70"
              >
                <span>Collateral to Move</span>
                <div className="flex items-center gap-2">
                  {selectedCollats.length > 0 && (
                    <span className="badge badge-xs rounded-none">{selectedCollats.length}</span>
                  )}
                  {collateralOpen ? <FiChevronUp className="w-3 h-3" /> : <FiChevronDown className="w-3 h-3" />}
                </div>
              </button>
              {collateralOpen && (
                <div className="mt-2 border border-base-300 rounded-none p-2">
                  <CollateralSelector
                    collaterals={collatsForSelector}
                    isLoading={isLoadingCollats || isLoadingSupport}
                    selectedProtocol={destProtocol}
                    onCollateralSelectionChange={onChangeCollats}
                    marketToken={position.tokenAddress}
                    hideAmounts={false}
                  />
                </div>
              )}
            </section>
          )}

          {/* Analytics (collapse) */}
          {position.type === "borrow" && (
            <section>
              <button
                onClick={() => setShowAdvanced(s => !s)}
                className="w-full flex items-center justify-between text-xs font-medium text-base-content/70"
              >
                <span>Position Analytics</span>
                {showAdvanced ? <FiChevronUp className="w-3 h-3" /> : <FiChevronDown className="w-3 h-3" />}
              </button>
              {showAdvanced && (
                <div className="mt-2 border border-base-300 rounded-none p-2 text-xs space-y-2">
                  <Row k="Moving Collateral" v={`$${fmt(collatsUsd)}`} />
                  <Row k="Remaining Collateral" v={`$${fmt(remainingCollateralUsd)}`} />
                  <Row k="Remaining Debt" v={`$${fmt(remainingDebtUsd)}`} />
                  <div className="pt-2 border-t border-base-300">
                    <Row
                      k="Effective LTV"
                      v={
                        remainingCollateralUsd > 0
                          ? ((remainingDebtUsd / remainingCollateralUsd) * 100).toFixed(1) + "%"
                          : "—"
                      }
                    />
                  </div>
                </div>
              )}
            </section>
          )}

          {/* Issues */}
          {issues.length > 0 && (
            <div className="border border-warning/40 text-warning rounded-none p-3 text-xs space-y-1">
              {issues.map((i, idx) => (
                <div key={idx}>• {i}</div>
              ))}
            </div>
          )}

          {/* Error */}
          {err && (
            <div className="border border-error/40 text-error rounded-none p-3 text-xs">{err}</div>
          )}
        </div>

        {/* FOOTER */}
        <div className="sticky bottom-0 bg-base-100 border-t border-base-300 p-3 space-y-2">
          {isPreferenceLoaded && (
            <label className="flex items-center gap-2 cursor-pointer text-xs">
              <input
                type="checkbox"
                checked={preferBatching}
                onChange={e => setPreferBatching(e.target.checked)}
                className="checkbox checkbox-xs rounded-none"
              />
              <span>Batch with Smart Account</span>
            </label>
          )}

          <button
            className={`btn btn-primary w-full h-11 text-sm rounded-none ${canConfirm ? "" : "btn-disabled"}`}
            onClick={handleConfirm}
            disabled={!canConfirm}
          >
            {loading && <span className="loading loading-spinner loading-sm" />}
            Confirm Migration
            <FaGasPump className="w-3 h-3 ml-2" />
          </button>

          <p className="text-[10px] text-center opacity-60">
            Flash-unlock debt → Move collateral → Borrow on destination
          </p>
        </div>
      </div>

      {/* Backdrop */}
      <form method="dialog" className="modal-backdrop backdrop-blur-[1px] bg-black/25" onClick={loading ? undefined : onClose}>
        <button disabled={loading}>close</button>
      </form>
    </dialog>
  );
};

// Compact key:value line
const Row: FC<{ k: string; v: string }> = ({ k, v }) => (
  <div className="flex items-center justify-between">
    <span className="text-base-content/70">{k}</span>
    <span className="font-medium">{v}</span>
  </div>
);
