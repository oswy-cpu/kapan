// MovePositionModal.compact.tsx
// Ultra-compact mobile-first design with adaptive spacing

import { FC, useCallback, useEffect, useMemo, useState } from "react";
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
import { useNetworkAwareReadContract } from "~~/hooks/useNetworkAwareReadContract";
import { getProtocolLogo } from "~~/utils/protocol";

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
  };
  chainId?: number;
}

const BALANCER_CHAINS = [42161, 8453, 10];
const AAVE_CHAINS = [42161, 8453, 10, 59144];

export const MovePositionModal: FC<MovePositionModalProps> = ({ 
  isOpen, 
  onClose, 
  fromProtocol, 
  position, 
  chainId 
}) => {
  const { address: userAddress, chain } = useAccount();
  const { switchChain } = useSwitchChain();

  const { createMoveBuilder, executeFlowBatchedIfPossible } = useKapanRouterV2();
  const { enabled: preferBatching, setEnabled: setPreferBatching, isLoaded: isPreferenceLoaded } = useBatchingPreference();
  const { data: routerContract } = useDeployedContractInfo({ contractName: "KapanRouter", chainId: chainId as any });
  
  const protocols = [{ name: "Aave V3" }, { name: "Compound V3" }, { name: "Venus" }];
  const availableProtocols = protocols.filter(p => p.name !== fromProtocol);

  // State
  const [destProtocol, setDestProtocol] = useState<string>(availableProtocols[0]?.name || "");
  const [flashProvider, setFlashProvider] = useState<FlashLoanProvider | null>(null);
  const [selectedCollats, setSelectedCollats] = useState<CollateralWithAmount[]>([]);
  const [amount, setAmount] = useState("");
  const [isMaxDebt, setIsMaxDebt] = useState(false);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [collateralOpen, setCollateralOpen] = useState(true);

  useEffect(() => {
    if (!isOpen || !chainId) return;
    if (chain?.id !== chainId) {
      try { switchChain?.({ chainId }); } catch {}
    }
  }, [isOpen, chainId, chain?.id, switchChain]);

  // Flash availability
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

  useEffect(() => {
    if (availableFlash.length === 0) setFlashProvider(null);
    else if (!flashProvider || !availableFlash.includes(flashProvider)) setFlashProvider(availableFlash[0]);
  }, [availableFlash, flashProvider]);

  const { collaterals: fetchedCollats, isLoading: isLoadingCollats } = useCollaterals(
    position.tokenAddress,
    fromProtocol,
    userAddress || "0x0000000000000000000000000000000000000000",
    isOpen,
  );

  const collateralAddresses = useMemo(
    () => fetchedCollats.map((c: any) => c.address),
    [JSON.stringify(fetchedCollats.map((c: any) => c.address))],
  );

  // Get debt balance for validation
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

  const { isLoading: isLoadingSupport, supportedCollaterals } = useCollateralSupport(
    destProtocol,
    position.tokenAddress,
    collateralAddresses,
    isOpen,
  );

  const collatsForSelector = useMemo(
    () =>
      fetchedCollats.map((c: any) => ({
        ...c,
        supported: supportedCollaterals[c.address] === true,
      })),
    [fetchedCollats, supportedCollaterals],
  );

  const { data: tokenPrices } = useNetworkAwareReadContract({
    networkType: "evm",
    contractName: "UiHelper",
    functionName: "get_asset_prices",
    args: [[...collatsForSelector.map(c => c.address), position.tokenAddress]],
    query: { enabled: isOpen },
  });

  const tokenToPrices = useMemo(() => {
    const map: Record<string, bigint> = {};
    const prices = (tokenPrices as unknown as bigint[]) || [];
    const addrs = [...collatsForSelector.map(c => c.address), position.tokenAddress];
    addrs.forEach((addr, i) => (map[(addr || "").toLowerCase()] = (prices[i] ?? 0n) / 10n ** 10n));
    return map;
  }, [tokenPrices, collatsForSelector, position.tokenAddress]);

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

  const fmt = (n: number, precision = 2) =>
    Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: precision, maximumFractionDigits: precision });

  const onChangeCollats = useCallback((cs: CollateralWithAmount[]) => {
    setSelectedCollats(cs);
  }, []);

  // Validation
  const issues: string[] = [];
  if (position.type === "borrow") {
    if (selectedCollats.length === 0) issues.push("Select collateral");
    if (collatsUsd < debtUsd * 1.2) issues.push("Collateral < 120% of debt");
    selectedCollats.forEach(c => {
      if (!c.supported) issues.push(`${c.symbol} not supported`);
      if (c.amount === 0n) issues.push(`Set ${c.symbol} amount`);
    });
  }
  if (!amount || parseFloat(amount) === 0) issues.push("Enter amount");

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

      // Compound market hint if needed
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

      // 1) Flash-unlock debt
      builder.buildUnlockDebt({
        fromProtocol,
        debtToken: position.tokenAddress as `0x${string}`,
        expectedDebt: debtStr,
        debtDecimals: (decimals as number) || position.decimals,
        flash: { version: flashProvider.version, premiumBps: 9, bufferBps: 10 },
      });

      // 2) Move collats
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

      // 3) Borrow on destination to repay flash
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

  return (
    <dialog open={isOpen} className="modal modal-open">
      <div className="modal-box max-w-lg w-full p-0 max-h-[90vh] flex flex-col">
        {/* Compact header */}
        <div className="sticky top-0 z-10 bg-base-100 border-b border-base-300 px-4 py-3">
          <div className="flex items-center justify-between">
            <h3 className="font-bold text-lg">Move Position</h3>
            <button onClick={onClose} className="btn btn-ghost btn-sm btn-circle" disabled={loading}>
              <FiX className="w-5 h-5" />
            </button>
          </div>
          
          {/* Compact protocol flow */}
          <div className="flex items-center gap-2 mt-2 text-xs">
            <div className="flex items-center gap-1.5">
              <Image src={getProtocolLogo(fromProtocol)} alt={fromProtocol} width={16} height={16} className="rounded-full" />
              <span className="font-medium">{fromProtocol}</span>
            </div>
            <span className="text-base-content/40">→</span>
            {destProtocol ? (
              <div className="flex items-center gap-1.5">
                <Image src={getProtocolLogo(destProtocol)} alt={destProtocol} width={16} height={16} className="rounded-full" />
                <span className="font-medium">{destProtocol}</span>
              </div>
            ) : (
              <span className="text-base-content/40">Select</span>
            )}
          </div>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {/* Destination - compact chips */}
          <div>
            <label className="text-xs font-medium text-base-content/70 mb-1.5 block">Destination</label>
            <div className="flex flex-wrap gap-1.5">
              {availableProtocols.map(p => (
                <button
                  key={p.name}
                  onClick={() => setDestProtocol(p.name)}
                  className={`
                    btn btn-sm h-8 gap-1.5 normal-case text-xs px-3
                    ${destProtocol === p.name ? 'btn-primary' : 'btn-outline'}
                  `}
                >
                  <Image src={getProtocolLogo(p.name)} alt={p.name} width={14} height={14} className="rounded-full" />
                  {p.name}
                </button>
              ))}
            </div>
          </div>

          {/* Flash loan - compact chips */}
          {position.type === "borrow" && availableFlash.length > 0 && (
            <div>
              <label className="text-xs font-medium text-base-content/70 mb-1.5 block">Flash Loan</label>
              <div className="flex flex-wrap gap-1.5">
                {availableFlash.map(fp => (
                  <button
                    key={fp.name}
                    onClick={() => setFlashProvider(fp)}
                    className={`
                      btn btn-sm h-8 gap-1.5 normal-case text-xs px-3
                      ${flashProvider?.name === fp.name ? 'btn-primary' : 'btn-outline'}
                    `}
                  >
                    <Image src={fp.icon} alt={fp.name} width={14} height={14} className="rounded-full" />
                    {fp.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Debt amount - compact */}
          <div>
            <label className="text-xs font-medium text-base-content/70 mb-1.5 flex items-center justify-between">
              <span>Debt Amount</span>
              <div className="flex items-center gap-1 text-[10px] text-base-content/60">
                <Image src={tokenNameToLogo(position.name)} alt={position.name} width={12} height={12} className="rounded-full" />
                {position.name}
              </div>
            </label>
            <div className="relative">
              <input
                type="text"
                className="input input-sm input-bordered w-full pr-14 text-right"
                placeholder="0.00"
                value={amount}
                onChange={e => setAmount(e.target.value)}
                disabled={loading}
              />
              <button
                className="absolute right-1 top-1/2 -translate-y-1/2 text-[10px] font-medium px-2 py-0.5 bg-primary/10 hover:bg-primary hover:text-white rounded transition-colors"
                onClick={() => {
                  const maxStr = tokenBalance && decimals 
                    ? formatUnits(tokenBalance as bigint, decimals as number)
                    : Math.abs(position.balance).toString();
                  setAmount(maxStr);
                  setIsMaxDebt(true);
                }}
                disabled={loading}
              >
                MAX
              </button>
            </div>
            <div className="flex justify-between text-[10px] text-base-content/50 mt-1">
              <span>Max: {fmt(position.balance)}</span>
              <span>≈ ${fmt(debtUsd)}</span>
            </div>
          </div>

          {/* Collateral - collapsible */}
          {position.type === "borrow" && (
            <div>
              <button
                onClick={() => setCollateralOpen(!collateralOpen)}
                className="flex items-center justify-between w-full text-xs font-medium text-base-content/70 mb-1.5"
              >
                <span>Collateral to Move</span>
                <div className="flex items-center gap-1.5">
                  {selectedCollats.length > 0 && (
                    <span className="badge badge-primary badge-xs">{selectedCollats.length}</span>
                  )}
                  {collateralOpen ? <FiChevronUp className="w-3 h-3" /> : <FiChevronDown className="w-3 h-3" />}
                </div>
              </button>

              {collateralOpen && (
                <CollateralSelector
                  collaterals={collatsForSelector}
                  isLoading={isLoadingCollats || isLoadingSupport}
                  selectedProtocol={destProtocol}
                  onCollateralSelectionChange={onChangeCollats}
                  marketToken={position.tokenAddress}
                  hideAmounts={false}
                />
              )}
            </div>
          )}

          {/* Warnings - compact */}
          {issues.length > 0 && (
            <div className="alert alert-warning py-2 px-3">
              <FiAlertTriangle className="w-4 h-4 flex-shrink-0" />
              <div className="text-xs space-y-0.5">
                {issues.map((issue, idx) => (
                  <div key={idx}>• {issue}</div>
                ))}
              </div>
            </div>
          )}

          {err && (
            <div className="alert alert-error py-2 px-3">
              <FiAlertTriangle className="w-4 h-4 flex-shrink-0" />
              <div className="text-xs">{err}</div>
            </div>
          )}
        </div>

        {/* Sticky footer - compact */}
        <div className="sticky bottom-0 bg-base-100 border-t border-base-300 p-3 space-y-2">
          {isPreferenceLoaded && (
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={preferBatching}
                onChange={e => setPreferBatching(e.target.checked)}
                className="checkbox checkbox-xs"
              />
              <span className="text-xs">Batch with Smart Account</span>
            </label>
          )}

          <button
            className={`btn btn-primary w-full h-11 text-sm ${canConfirm ? "" : "btn-disabled"}`}
            onClick={handleConfirm}
            disabled={!canConfirm}
          >
            {loading && <span className="loading loading-spinner loading-sm" />}
            Confirm Migration
            <FaGasPump className="w-3 h-3" />
          </button>

          <p className="text-[10px] text-center text-base-content/50">
            Flash-unlock debt → Move collateral → Borrow on destination
          </p>
        </div>
      </div>

      <form method="dialog" className="modal-backdrop backdrop-blur-sm bg-black/20" onClick={loading ? undefined : onClose}>
        <button disabled={loading}>close</button>
      </form>
    </dialog>
  );
};