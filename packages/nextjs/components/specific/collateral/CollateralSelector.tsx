import React, { FC, useState, useEffect, useMemo, useCallback } from "react";
import Image from "next/image";
import { FiChevronDown, FiChevronUp } from "react-icons/fi";
import { formatUnits, parseUnits } from "viem";
import { tokenNameToLogo } from "~~/contracts/externalContracts";

export interface CollateralToken {
  symbol: string;
  balance: number;
  address: string;
  decimals: number;
  rawBalance: bigint;
  supported: boolean;
}

export interface CollateralWithAmount {
  token: string;
  amount: bigint;
  symbol: string;
  decimals: number;
  maxAmount: bigint;
  inputValue?: string;
  supported: boolean;
}

interface CollateralSelectorProps {
  collaterals: CollateralToken[];
  isLoading: boolean;
  selectedProtocol?: string;
  marketToken: string;
  onCollateralSelectionChange: (collaterals: CollateralWithAmount[]) => void;
  onMaxClick?: (collateralToken: string, maxAmount: bigint, formattedMaxAmount: string) => void;
  hideAmounts?: boolean;
  initialSelectedCollaterals?: CollateralWithAmount[];
}

export const CollateralSelector: FC<CollateralSelectorProps> = ({
  collaterals,
  isLoading,
  selectedProtocol,
  marketToken,
  onCollateralSelectionChange,
  onMaxClick,
  hideAmounts = false,
  initialSelectedCollaterals,
}) => {
  const [selectedCollaterals, setSelectedCollaterals] = useState<CollateralWithAmount[]>([]);
  const [showUnsupported, setShowUnsupported] = useState(false);

  useEffect(() => {
    if (initialSelectedCollaterals?.length && selectedCollaterals.length === 0) {
      setSelectedCollaterals(initialSelectedCollaterals);
    }
  }, [initialSelectedCollaterals]);

  const collateralSupportMap = useMemo(() => {
    return collaterals.reduce((acc, collateral) => {
      acc[collateral.address] = collateral.supported;
      return acc;
    }, {} as Record<string, boolean>);
  }, [collaterals]);

  // Filter and sort: only show supported with balance, unless user wants to see all
  const { availableCollaterals, unsupportedCount } = useMemo(() => {
    const available = collaterals.filter(
      c => c.supported && c.rawBalance > 0n
    );
    const unsupported = collaterals.filter(
      c => !c.supported || c.rawBalance === 0n
    );

    const sorted = [...available].sort((a, b) => {
      if (a.balance > b.balance) return -1;
      if (a.balance < b.balance) return 1;
      return a.symbol.localeCompare(b.symbol);
    });

    return {
      availableCollaterals: sorted,
      unsupportedCount: unsupported.length,
    };
  }, [collaterals]);

  const displayCollaterals = showUnsupported ? collaterals : availableCollaterals;

  const formatBalance = (balance: number) => {
    if (balance > 0 && balance < 0.01) return "<0.01";
    if (balance > 1000000) return (balance / 1000000).toFixed(2) + "M";
    if (balance > 1000) return (balance / 1000).toFixed(2) + "K";
    return balance.toLocaleString(undefined, { maximumFractionDigits: 4 });
  };

  const handleCollateralToggle = useCallback((collateral: CollateralToken) => {
    if (!collateral.supported || collateral.rawBalance <= 0n) return;

    setSelectedCollaterals(prev => {
      const existingIndex = prev.findIndex(c => c.token === collateral.address);
      if (existingIndex >= 0) {
        return prev.filter(c => c.token !== collateral.address);
      } else {
        return [
          ...prev,
          {
            token: collateral.address,
            amount: 0n,
            symbol: collateral.symbol,
            decimals: collateral.decimals,
            maxAmount: collateral.rawBalance,
            supported: collateral.supported,
          },
        ];
      }
    });
  }, []);

  useEffect(() => {
    if (!selectedProtocol) return;
    setSelectedCollaterals(prev => {
      const updated = prev.map(c => ({
        ...c,
        supported: collateralSupportMap[c.token] ?? false,
      }));
      const hasChanged = updated.some((collateral, index) => 
        collateral.supported !== prev[index].supported
      );
      return hasChanged ? updated : prev;
    });
  }, [collateralSupportMap, selectedProtocol]);

  const handleAmountChange = (token: string, amountStr: string, decimals: number) => {
    setSelectedCollaterals(prev => {
      return prev.map(c => {
        if (c.token === token) {
          try {
            if (!amountStr || amountStr === "" || amountStr === ".") {
              return { ...c, amount: 0n, inputValue: amountStr };
            }
            let amount = parseUnits(amountStr, decimals);
            if (amount > c.maxAmount) {
              amount = c.maxAmount;
              return { ...c, amount, inputValue: formatUnits(c.maxAmount, decimals) };
            }
            return { ...c, amount, inputValue: amountStr };
          } catch {
            return { ...c, amount: 0n, inputValue: amountStr };
          }
        }
        return c;
      });
    });
  };

  const handleSetMax = (token: string) => {
    const selected = selectedCollaterals.find(c => c.token === token);
    if (selected) {
      const maxAmount = selected.maxAmount;
      const formattedMaxAmount = formatUnits(maxAmount, selected.decimals);
      const updated = selectedCollaterals.map(c =>
        c.token === token ? { ...c, amount: maxAmount, inputValue: formattedMaxAmount } : c
      );
      setSelectedCollaterals(updated);
      onCollateralSelectionChange(updated);
      if (onMaxClick) {
        onMaxClick(token, maxAmount, formattedMaxAmount);
      }
    }
  };

  useEffect(() => {
    onCollateralSelectionChange(selectedCollaterals);
  }, [selectedCollaterals, onCollateralSelectionChange]);

  const isCollateralSelected = (address: string) => {
    return selectedCollaterals.some(c => c.token === address);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <span className="loading loading-spinner loading-md"></span>
        <span className="ml-2 text-sm">Loading...</span>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Compact header */}
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium">Select Collateral</span>
        {selectedCollaterals.length > 0 && (
          <span className="badge badge-primary badge-sm">{selectedCollaterals.length}</span>
        )}
      </div>

      {availableCollaterals.length === 0 ? (
        <div className="text-center py-6 text-sm text-base-content/60">
          No collateral available
        </div>
      ) : (
        <>
          {/* Compact collateral list */}
          <div className="space-y-1.5">
            {displayCollaterals.map(collateral => {
              const isDisabled = !collateral.supported || collateral.rawBalance <= 0n;
              const isSelected = isCollateralSelected(collateral.address);
              const selectedAmount = selectedCollaterals.find(c => c.token === collateral.address);

              return (
                <div key={collateral.address}>
                  {/* Compact selection row */}
                  <button
                    onClick={() => handleCollateralToggle(collateral)}
                    disabled={isDisabled}
                    className={`
                      w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm
                      transition-colors
                      ${isSelected 
                        ? 'bg-primary/10 border border-primary/30' 
                        : 'bg-base-200/50 hover:bg-base-200'
                      }
                      ${isDisabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}
                    `}
                  >
                    {/* Checkbox */}
                    <div className={`
                      w-4 h-4 rounded border-2 flex items-center justify-center flex-shrink-0
                      ${isSelected ? 'bg-primary border-primary' : 'border-base-300'}
                    `}>
                      {isSelected && (
                        <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                    </div>

                    {/* Icon */}
                    <div className="w-6 h-6 relative flex-shrink-0">
                      <Image
                        src={tokenNameToLogo(collateral.symbol)}
                        alt={collateral.symbol}
                        fill
                        className="rounded-full object-contain"
                      />
                    </div>

                    {/* Symbol */}
                    <span className="font-medium flex-1 text-left">{collateral.symbol}</span>

                    {/* Balance */}
                    <span className="text-xs text-base-content/60 tabular-nums">
                      {formatBalance(collateral.balance)}
                    </span>

                    {/* Warning badge */}
                    {isDisabled && (
                      <span className="text-[10px] px-1.5 py-0.5 bg-warning/20 text-warning rounded">
                        {collateral.rawBalance === 0n ? 'Empty' : 'Not supported'}
                      </span>
                    )}
                  </button>

                  {/* Inline amount input - only when selected */}
                  {!hideAmounts && isSelected && selectedAmount && (
                    <div className="mt-1.5 ml-6 mr-2">
                      <div className="flex items-center gap-2">
                        <div className="flex-1 relative">
                          <input
                            type="text"
                            value={selectedAmount.inputValue ?? 
                              (selectedAmount.amount === 0n ? "" : formatUnits(selectedAmount.amount, selectedAmount.decimals))
                            }
                            onChange={(e) => handleAmountChange(collateral.address, e.target.value, collateral.decimals)}
                            className="input input-sm input-bordered w-full text-right pr-12"
                            placeholder="0.00"
                            disabled={!selectedAmount.supported}
                          />
                          <button
                            onClick={() => handleSetMax(collateral.address)}
                            className="absolute right-1 top-1/2 -translate-y-1/2 text-[10px] font-medium px-2 py-0.5 bg-primary/10 hover:bg-primary hover:text-white rounded transition-colors"
                            disabled={!selectedAmount.supported}
                          >
                            MAX
                          </button>
                        </div>
                      </div>
                      <div className="text-[10px] text-base-content/50 text-right mt-0.5">
                        Max: {formatBalance(collateral.balance)}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Show unsupported toggle - only if there are unsupported items */}
          {unsupportedCount > 0 && (
            <button
              onClick={() => setShowUnsupported(!showUnsupported)}
              className="btn btn-ghost btn-xs w-full gap-1 text-xs"
            >
              {showUnsupported ? <FiChevronUp /> : <FiChevronDown />}
              {showUnsupported ? 'Hide' : 'Show'} unsupported ({unsupportedCount})
            </button>
          )}

          {/* Compact summary */}
          {!hideAmounts && selectedCollaterals.length > 0 && (
            <div className="bg-base-200/30 rounded-lg p-2.5 space-y-1 text-xs">
              <div className="font-medium text-base-content/70 mb-1">Summary</div>
              {selectedCollaterals.map(c => (
                <div key={c.token} className="flex justify-between items-center">
                  <span className="text-base-content/60">{c.symbol}</span>
                  <span className="font-medium tabular-nums">
                    {c.amount === 0n ? (
                      <span className="text-warning">Not set</span>
                    ) : (
                      formatUnits(c.amount, c.decimals)
                    )}
                  </span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
};