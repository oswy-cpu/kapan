import React, { FC } from "react";
import Image from "next/image";
import { FiX } from "react-icons/fi";
import { formatUnits, parseUnits } from "viem";
import { tokenNameToLogo } from "~~/contracts/externalContracts";
import type { CollateralWithAmount } from "./CollateralSelector";

interface CollateralAmountsProps {
  collaterals: CollateralWithAmount[];
  onChange: (updated: CollateralWithAmount[]) => void;
  selectedProtocol?: string;
  onMaxClick?: (token: string, isMax: boolean) => void;
}

export const CollateralAmounts: FC<CollateralAmountsProps> = ({
  collaterals,
  onChange,
  selectedProtocol,
  onMaxClick,
}) => {
  const handleAmountChange = (token: string, amountStr: string, decimals: number) => {
    const updated = collaterals.map(c => {
      if (c.token !== token) return c;
      try {
        const amount = parseUnits(amountStr || "0", decimals);
        return { ...c, amount, inputValue: amountStr };
      } catch {
        return { ...c, amount: 0n, inputValue: amountStr };
      }
    });
    onChange(updated);
    onMaxClick?.(token, false);
  };

  const handleSetMax = (token: string, maxAmount: bigint, decimals: number) => {
    const maxStr = formatUnits(maxAmount, decimals);
    const updated = collaterals.map(c =>
      c.token === token ? { ...c, amount: maxAmount, inputValue: maxStr } : c,
    );
    onChange(updated);
    onMaxClick?.(token, true);
  };

  const handleRemove = (token: string) => {
    const updated = collaterals.filter(c => c.token !== token);
    onChange(updated);
  };

  if (collaterals.length === 0) return null;

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <label className="text-base font-semibold text-base-content">
          Collateral Amounts
        </label>
        <span className="text-xs text-base-content/60">
          {collaterals.length} token{collaterals.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Collateral list */}
      <div className="space-y-3">
        {collaterals.map(c => {
          const displayAmount = c.inputValue ?? (c.amount === 0n ? "" : formatUnits(c.amount, c.decimals));
          const isSupported = c.supported;
          const maxFormatted = formatUnits(c.maxAmount, c.decimals);
          
          return (
            <div
              key={c.token}
              className={`
                relative rounded-xl border-2 p-4
                ${isSupported 
                  ? 'border-base-300 bg-base-100' 
                  : 'border-warning/30 bg-warning/5'
                }
              `}
            >
              {/* Token header */}
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 relative flex-shrink-0">
                  <Image
                    src={tokenNameToLogo(c.symbol)}
                    alt={c.symbol}
                    fill
                    className={`rounded-full object-contain ${!isSupported ? 'grayscale' : ''}`}
                  />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-base truncate">
                    {c.symbol}
                  </div>
                  <div className="text-xs text-base-content/60 tabular-nums">
                    Available: {maxFormatted}
                  </div>
                </div>
                {/* Remove button */}
                <button
                  onClick={() => handleRemove(c.token)}
                  className="btn btn-ghost btn-sm btn-circle"
                  aria-label="Remove collateral"
                >
                  <FiX className="w-5 h-5" />
                </button>
              </div>

              {/* Amount input */}
              <div className="relative">
                <input
                  type="text"
                  value={displayAmount}
                  onChange={e => handleAmountChange(c.token, e.target.value, c.decimals)}
                  className={`
                    input input-bordered w-full h-14 text-lg pr-20
                    ${!isSupported ? 'input-warning' : ''}
                  `}
                  placeholder="0.00"
                  disabled={!isSupported}
                />
                <button
                  className="btn btn-primary btn-sm absolute right-2 top-1/2 -translate-y-1/2"
                  onClick={() => handleSetMax(c.token, c.maxAmount, c.decimals)}
                  disabled={!isSupported}
                >
                  MAX
                </button>
              </div>

              {/* Warning for unsupported */}
              {!isSupported && (
                <div className="mt-3 text-xs text-warning flex items-start gap-2">
                  <span className="font-medium">⚠️</span>
                  <span>Not supported in {selectedProtocol}</span>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default CollateralAmounts;