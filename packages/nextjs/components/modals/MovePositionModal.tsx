// MovePositionModal.tsx
import { FC, useCallback, useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { FaGasPump } from "react-icons/fa";
import { FiAlertTriangle, FiLock } from "react-icons/fi";
import { formatUnits } from "viem";
import { useAccount, useReadContract, useSwitchChain } from "wagmi";
import { CollateralAmounts } from "~~/components/specific/collateral/CollateralAmounts";
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
import { CompactCollateralAmounts } from "../specific/collateral/CompactCollateralAmounts";

type FlashLoanProvider = {
  name: "Balancer V2" | "Balancer V3" | "Aave V3";
  icon: string;
  version: "v2" | "v3" | "aave";
  providerEnum: 0 | 1 | 2;
};

const ALL_FLASH_LOAN_PROVIDERS: FlashLoanProvider[] = [
  { name: "Balancer V2", icon: "/logos/balancer.svg", version: "v2", providerEnum: 0 },
  { name: "Balancer V3", icon: "/logos/balancer.svg", version: "v3", providerEnum: 1 },
  { name: "Aave V3",     icon: "/logos/aave.svg",     version: "aave", providerEnum: 2 },
] as const;

interface MovePositionModalProps {
  isOpen: boolean;
  onClose: () => void;
  fromProtocol: string;
  position: {
    name: string;            // token symbol (e.g., USDC)
    balance: number;         // USD (display-only fallback)
    type: "supply" | "borrow";
    tokenAddress: string;
    decimals: number;
  };
  chainId?: number;
}

const BALANCER_CHAINS = [42161, 8453, 10];         // Arb, Base, Opt
const AAVE_CHAINS     = [42161, 8453, 10, 59144];  // + Linea

export const MovePositionModal: FC<MovePositionModalProps> = ({ isOpen, onClose, fromProtocol, position, chainId }) => {
  const { address: userAddress, chain } = useAccount();
  const { switchChain } = useSwitchChain();

  // Router + batching
  const { createMoveBuilder, executeFlowBatchedIfPossible } = useKapanRouterV2();
  const { enabled: preferBatching, setEnabled: setPreferBatching, isLoaded: isPreferenceLoaded } = useBatchingPreference();

  // Contracts
  const { data: routerContract } = useDeployedContractInfo({ contractName: "KapanRouter", chainId: chainId as any });
  const protocols = [{ name: "Aave V3" }, { name: "Compound V3" }, { name: "Venus" }];
  const availableProtocols = protocols.filter(p => p.name !== fromProtocol);

  // Selections (single-screen)
  const [destProtocol, setDestProtocol] = useState<string>(availableProtocols[0]?.name || "");
  const [flashProvider, setFlashProvider] = useState<FlashLoanProvider | null>(null);
  const [selectedCollats, setSelectedCollats] = useState<CollateralWithAmount[]>([]);
  const [amount, setAmount] = useState("");
  const [isMaxDebt, setIsMaxDebt] = useState(false);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [destOpen, setDestOpen] = useState(false);
  const [flashOpen, setFlashOpen] = useState(false);
  
  const blurActive = () => {
    const el = document.activeElement as HTMLElement | null;
    if (el && typeof el.blur === "function") el.blur();
  };
  // Network guard
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
    if (aaveEnabled     && chainId && AAVE_CHAINS.includes(chainId))     out.push(ALL_FLASH_LOAN_PROVIDERS[2]);
    return out;
  }, [balancerV2Enabled, balancerV3Enabled, aaveEnabled, chainId]);

  useEffect(() => {
    if (availableFlash.length === 0) setFlashProvider(null);
    else if (!flashProvider || !availableFlash.includes(flashProvider)) setFlashProvider(availableFlash[0]);
  }, [availableFlash, flashProvider]);

  // Collaterals on source
  const { collaterals: fetchedCollats, isLoading: isLoadingCollats } = useCollaterals(
    position.tokenAddress,
    fromProtocol,
    userAddress || "0x0000000000000000000000000000000000000000",
    isOpen,
  );
  const collateralAddresses = useMemo(
    () => fetchedCollats.map((c: any) => c.address),
    // stable dep while avoiding object identity churn
    [JSON.stringify(fetchedCollats.map((c: any) => c.address))],
  );

  // Support map for destination
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

  // Prices (collats + debt)
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
    addrs.forEach((addr, i) => (map[(addr || "").toLowerCase()] = (prices[i] ?? 0n) / 10n ** 10n)); // keep as 1e8
    return map;
  }, [tokenPrices, collatsForSelector, position.tokenAddress]);

  // Debt balance
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

  // Helpers
  const fmt = (n: number | string, maxFrac = 6) => {
    const v = typeof n === "string" ? parseFloat(n) : n;
    if (isNaN(v)) return "0.00";
    return new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: maxFrac }).format(v);
  };

  const debtTokenPrice = useMemo(
    () => Number(formatUnits(tokenToPrices[(position.tokenAddress || "").toLowerCase()] || 0n, 8)),
    [tokenToPrices, position.tokenAddress],
  );

  const formattedDebtBalance = useMemo(() => {
    if (!tokenBalance || !decimals) return "0";
    return formatUnits(tokenBalance, decimals as number);
  }, [tokenBalance, decimals]);

  const debtUsd = useMemo(() => {
    const n = parseFloat(amount || "0");
    if (!n || !debtTokenPrice) return 0;
    return n * debtTokenPrice;
  }, [amount, debtTokenPrice]);

  const collatsUsd = useMemo(
    () =>
      selectedCollats.reduce((sum, c) => {
        const addr = ((c as any).token || (c as any).address || "").toLowerCase();
        const p = tokenToPrices[addr];
        const normalized = Number(formatUnits(c.amount, c.decimals));
        const usd = p ? normalized * Number(formatUnits(p, 8)) : 0;
        return sum + usd;
      }, 0),
    [selectedCollats, tokenToPrices],
  );

  // Inline validation (single page)
  const issues = useMemo(() => {
    const list: string[] = [];
    if (!destProtocol) list.push("Select a destination protocol.");
    if (position.type === "borrow" && availableFlash.length === 0) list.push("No flash loan provider available on this network.");
    if (chainId && chain?.id !== chainId) list.push("Wrong network selected in wallet.");
    if (position.type === "borrow") {
      if (!isLoadingSupport && !collatsForSelector.some(c => c.supported)) list.push("Destination has no supported collateral.");
      if (selectedCollats.length === 0) list.push("Choose at least one collateral to move.");
    }
    const n = parseFloat(amount || "0");
    if (!amount || isNaN(n) || n <= 0) list.push("Enter a valid debt amount.");
    if (n > parseFloat(formattedDebtBalance)) list.push("Amount exceeds your current debt.");
    return list;
  }, [
    destProtocol,
    position.type,
    availableFlash.length,
    chainId,
    chain?.id,
    isLoadingSupport,
    collatsForSelector,
    selectedCollats.length,
    amount,
    formattedDebtBalance,
  ]);

  const canConfirm = issues.length === 0 && !loading;

  // Actions
  const onChangeCollats = useCallback((list: CollateralWithAmount[]) => setSelectedCollats(list), []);

  const setMaxAmount = () => {
    setAmount(formattedDebtBalance);
    setIsMaxDebt(true);
  };

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

  // UI
  return (
    <dialog className={`modal ${isOpen ? "modal-open" : ""}`}>
      <div className="modal-box bg-base-100 max-w-6xl max-h-[90vh] p-6 rounded-none">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-base-300 pb-3 mb-5">
          <div className="flex items-center gap-3">
            <Image src={getProtocolLogo(fromProtocol)} alt={fromProtocol} width={28} height={28} className="rounded-full" />
            <div className="text-sm">
              <div className="font-semibold">Move Position</div>
              <div className="text-xs text-base-content/60">
                {fromProtocol} • {position.type === "borrow" ? "Moving borrow" : "Moving supply"}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <div className="w-6 h-6 relative">
              <Image src={tokenNameToLogo(position.name)} alt={position.name} fill className="rounded-full object-contain" />
            </div>
            <div className="font-medium">{position.name}</div>
            <div className="text-xs text-base-content/60">Debt: {formatUnits((tokenBalance || 0n) as bigint, (decimals as number) || position.decimals)} {position.name}</div>
          </div>
        </div>

        {/* Body: compact two-column */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Left: inputs */}
          <div className="lg:col-span-7 space-y-6">

            {/* Destination protocol */}
            <section className="card bg-base-200 p-4">
              <div className="text-sm font-medium mb-2">Destination Protocol</div>

              <div className={`dropdown w-full ${destOpen ? "dropdown-open" : ""}`}>
                <div
                  tabIndex={0}
                  role="button"
                  className="border-b-2 border-base-300 py-3 px-1 flex items-center justify-between cursor-pointer h-14"
                  onClick={() => setDestOpen(o => !o)}
                  onKeyDown={e => e.key === "Escape" && setDestOpen(false)}
                >
                  <div className="flex items-center gap-3 w-[calc(100%-32px)] overflow-hidden">
                    {destProtocol ? (
                      <>
                        <Image src={getProtocolLogo(destProtocol)} alt={destProtocol} width={28} height={28} className="rounded-full min-w-[28px]" />
                        <span className="truncate font-semibold">{destProtocol}</span>
                      </>
                    ) : (
                      <span className="text-base-content/50">Select protocol</span>
                    )}
                  </div>
                  <svg className="w-4 h-4 opacity-70" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"/>
                  </svg>
                </div>

                <ul
                  tabIndex={0}
                  className="dropdown-content menu p-2 shadow-lg bg-base-100 rounded-lg w-full z-50 dropdown-bottom mt-1"
                  onClickCapture={() => { setDestOpen(false); blurActive(); }}
                >
                  {availableProtocols.map(p => (
                    <li key={p.name}>
                      <button
                        className="flex items-center gap-3 py-2"
                        onClick={() => { setDestProtocol(p.name); setDestOpen(false); blurActive(); }}
                      >
                        <Image src={getProtocolLogo(p.name)} alt={p.name} width={28} height={28} className="rounded-full" />
                        <span className="truncate">{p.name}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            </section>

            {/* Flash provider (shown only for borrow) */}
            {position.type === "borrow" && (
              <section className="card bg-base-200 p-4">
                <div className="text-sm font-medium mb-2">Flash Loan Provider</div>
                {availableFlash.length <= 1 ? (
                  <div className="flex items-center gap-3 h-14 border-b-2 border-base-300 px-1">
                    {flashProvider ? (
                      <>
                        <Image src={flashProvider.icon} alt={flashProvider.name} width={24} height={24} className="rounded-full" />
                        <span className="font-semibold">{flashProvider.name}</span>
                      </>
                    ) : (
                      <span className="text-base-content/60 text-sm">Not available on this chain</span>
                    )}
                  </div>
                ) : (
                  <div className={`dropdown w-full ${flashOpen ? "dropdown-open" : ""}`}>
                    <div
                      tabIndex={0}
                      role="button"
                      className="border-b-2 border-base-300 py-3 px-1 flex items-center justify-between cursor-pointer h-14"
                      onClick={() => setFlashOpen(o => !o)}
                      onKeyDown={e => e.key === "Escape" && setFlashOpen(false)}
                    >
                      <div className="flex items-center gap-3 w-[calc(100%-32px)] overflow-hidden">
                        {flashProvider && (
                          <>
                            <Image src={flashProvider.icon} alt={flashProvider.name} width={24} height={24} className="rounded-full" />
                            <span className="truncate font-semibold">{flashProvider.name}</span>
                          </>
                        )}
                      </div>
                      <svg className="w-4 h-4 opacity-70" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"/>
                      </svg>
                    </div>

                    <ul
                      tabIndex={0}
                      className="dropdown-content menu p-2 shadow-lg bg-base-100 rounded-lg w-full z-50 dropdown-bottom mt-1"
                      onClickCapture={() => { setFlashOpen(false); blurActive(); }}
                    >
                      {availableFlash.map(p => (
                        <li key={p.name}>
                          <button
                            className="flex items-center gap-3 py-2"
                            onClick={() => { setFlashProvider(p); setFlashOpen(false); blurActive(); }}
                          >
                            <Image src={p.icon} alt={p.name} width={24} height={24} className="rounded-full" />
                            <span className="truncate">{p.name}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </section>
            )}

            {/* Collateral picker (borrow only) */}
            {position.type === "borrow" && (
              <section className="card bg-base-200 p-4">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-medium">Collaterals to Move</div>
                  <div className="text-xs text-base-content/60">{isLoadingSupport ? "Checking support…" : ""}</div>
                </div>
                <CollateralSelector
                  collaterals={collatsForSelector}
                  isLoading={isLoadingCollats || isLoadingSupport}
                  selectedProtocol={destProtocol}
                  onCollateralSelectionChange={onChangeCollats}
                  marketToken={position.tokenAddress}
                  hideAmounts
                />
                {selectedCollats.length > 0 && (
                  <div className="mt-4">
                    <CollateralAmounts
                      collaterals={selectedCollats}
                      onChange={setSelectedCollats}
                      selectedProtocol={destProtocol}
                    />
                  </div>
                )}
              </section>
            )}

            {/* Debt amount */}
            <section className="card bg-base-200 p-4">
              <div className="text-sm font-medium mb-2">Debt Amount</div>
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-2 w-36 shrink-0">
                  <div className="w-6 h-6 relative">
                    <Image src={tokenNameToLogo(position.name)} alt={position.name} fill className="rounded-full object-contain" />
                  </div>
                  <span className="truncate font-medium">{position.name}</span>
                </div>
                <input
                  type="text"
                  className="flex-1 border-b-2 border-base-300 focus:border-primary bg-transparent px-2 h-12 text-lg text-right"
                  placeholder="0.00"
                  value={amount}
                  onChange={e => { setAmount(e.target.value); setIsMaxDebt(false); }}
                  disabled={loading}
                />
                <button className="btn btn-ghost btn-xs" onClick={() => setMaxAmount()} disabled={loading}>MAX</button>
              </div>
              <div className="flex justify-between text-xs text-base-content/60 mt-2">
                <span>Available: {fmt(formattedDebtBalance)} {position.name}</span>
                <span>≈ ${fmt(debtUsd)}</span>
              </div>
            </section>

            {/* Inline issues */}
            {issues.length > 0 && (
              <div className="alert alert-warning">
                <FiAlertTriangle className="w-5 h-5" />
                <div className="text-sm space-y-1">
                  {issues.map((i, idx) => <div key={idx}>• {i}</div>)}
                </div>
              </div>
            )}

            {err && (
              <div className="alert alert-error">
                <FiAlertTriangle className="w-5 h-5" />
                <div className="text-sm">{err}</div>
              </div>
            )}
          </div>

          {/* Right: sticky summary */}
          <div className="lg:col-span-5">
            <div className="lg:sticky lg:top-4 space-y-4">
              <section className="card bg-base-200 p-4">
                <div className="text-sm text-base-content/70 mb-1">From → To</div>
                <div className="flex items-center gap-3">
                  <Image src={getProtocolLogo(fromProtocol)} alt={fromProtocol} width={22} height={22} className="rounded-full" />
                  <span className="font-medium">{fromProtocol}</span>
                  <span className="opacity-50">→</span>
                  {destProtocol ? (
                    <>
                      <Image src={getProtocolLogo(destProtocol)} alt={destProtocol} width={22} height={22} className="rounded-full" />
                      <span className="font-medium">{destProtocol}</span>
                    </>
                  ) : <span className="text-base-content/60">Select destination</span>}
                </div>

                {position.type === "borrow" && flashProvider && (
                  <div className="mt-3 text-sm">
                    <span className="text-base-content/70 mr-2">Flash:</span>
                    <span className="inline-flex items-center gap-2">
                      <Image src={flashProvider.icon} alt={flashProvider.name} width={16} height={16} className="rounded-full" />
                      {flashProvider.name}
                    </span>
                  </div>
                )}
              </section>

              <section className="card bg-base-200 p-4">
                <div className="text-sm text-base-content/70 mb-1">Debt</div>
                <div className="flex items-center gap-2">
                  <div className="w-5 h-5 relative">
                    <Image src={tokenNameToLogo(position.name)} alt={position.name} fill className="rounded-full object-contain" />
                  </div>
                  <div className="font-medium">{amount || "0.00"} {position.name}</div>
                  <div className="text-xs text-base-content/60">≈ ${fmt(debtUsd)}</div>
                </div>
              </section>

              {position.type === "borrow" && (
                <section className="card bg-base-200 p-4">
                  <div className="text-sm text-base-content/70 mb-2">Collaterals</div>
                  {selectedCollats.length === 0 ? (
                    <div className="text-sm text-base-content/60">None</div>
                  ) : (
                    <div className="space-y-2 text-sm">
                      {selectedCollats.map((c, i) => {
                        const addr = ((c as any).token || (c as any).address || "").toLowerCase();
                        const p = tokenToPrices[addr];
                        const normalized = Number(formatUnits(c.amount, c.decimals));
                        const usd = p ? normalized * Number(formatUnits(p, 8)) : 0;
                        return (
                          <div key={i} className="flex justify-between">
                            <div className="flex items-center gap-2">
                              <span className="font-medium">{c.symbol}</span>
                              <span className="text-base-content/60">{formatUnits(c.amount, c.decimals)}</span>
                            </div>
                            <span className="text-base-content/70">${fmt(usd)}</span>
                          </div>
                        );
                      })}
                      <div className="pt-2 border-t border-base-300 flex justify-between font-medium">
                        <span>Total</span>
                        <span>${fmt(collatsUsd)}</span>
                      </div>
                    </div>
                  )}
                </section>
              )}

              {/* Batch + Confirm */}
              <div className="card bg-base-200 p-4">
                {isPreferenceLoaded && (
                  <label className="label cursor-pointer gap-2 mb-3">
                    <input
                      type="checkbox"
                      checked={preferBatching}
                      onChange={e => setPreferBatching(e.target.checked)}
                      className="checkbox checkbox-sm"
                    />
                    <span className="label-text text-xs">Batch transactions with Smart Account</span>
                  </label>
                )}
                <button
                  className={`btn btn-primary w-full h-12 ${canConfirm ? "" : "btn-disabled"}`}
                  onClick={handleConfirm}
                  disabled={!canConfirm}
                >
                  {loading && <span className="loading loading-spinner loading-sm mr-2" />}
                  Confirm & Migrate
                  <FaGasPump className="ml-2 opacity-80" />
                </button>
                <div className="text-[11px] text-base-content/60 mt-2">
                  By confirming, the router will flash-unlock your debt, move selected collateral, and borrow on the destination to repay flash.
                </div>
              </div>
            </div>
          </div>
        </div>

        <form method="dialog" className="modal-backdrop backdrop-blur-sm bg-black/20" onClick={loading ? undefined : onClose}>
          <button disabled={loading}>close</button>
        </form>
      </div>
    </dialog>
  );
};
