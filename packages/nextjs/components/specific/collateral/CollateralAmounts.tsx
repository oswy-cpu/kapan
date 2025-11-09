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
    <div className="space-y-2">
      {/* Header (denser) */}
      <div className="flex items-center justify-between">
        <label className="text-sm font-medium text-base-content">
          Collateral Amounts
        </label>
        <span className="text-[11px] text-base-content/60">
          {collaterals.length} token{collaterals.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Collateral list (square, compact) */}
      <div className="space-y-2">
        {collaterals.map(c => {
          const displayAmount =
            c.inputValue ?? (c.amount === 0n ? "" : formatUnits(c.amount, c.decimals));
          const isSupported = c.supported;
          const maxFormatted = formatUnits(c.maxAmount, c.decimals);

          return (
            <div
              key={c.token}
              className={[
                "relative rounded-none border p-3",
                isSupported ? "border-base-300 bg-base-100" : "border-warning/40 bg-warning/5",
              ].join(" ")}
            >
              {/* Token header (tight) */}
              <div className="flex items-center gap-2 mb-2">
                <div className="w-8 h-8 relative flex-shrink-0 overflow-hidden">
                  <Image
                    src={tokenNameToLogo(c.symbol)}
                    alt={c.symbol}
                    fill
                    className={["object-contain", !isSupported ? "grayscale" : ""].join(" ")}
                  />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sm truncate">{c.symbol}</div>
                  <div className="text-[11px] text-base-content/60 tabular-nums">
                    Available: {maxFormatted}
                  </div>
                </div>

                {/* Remove (square) */}
                <button
                  onClick={() => handleRemove(c.token)}
                  className="btn btn-ghost btn-xs rounded-none"
                  aria-label="Remove collateral"
                >
                  <FiX className="w-4 h-4" />
                </button>
              </div>

              {/* Amount input (smaller height, square, no overflow) */}
              <div className="relative">
                <input
                  type="text"
                  value={displayAmount}
                  onChange={e => handleAmountChange(c.token, e.target.value, c.decimals)}
                  className={[
                    "input input-bordered w-full input-sm text-right pr-16 rounded-none",
                    !isSupported ? "input-warning" : "",
                  ].join(" ")}
                  placeholder="0.00"
                  disabled={!isSupported}
                />
                <button
                  className="btn btn-xs btn-primary absolute right-2 top-1/2 -translate-y-1/2 rounded-none"
                  onClick={() => handleSetMax(c.token, c.maxAmount, c.decimals)}
                  disabled={!isSupported}
                >
                  MAX
                </button>
              </div>

              {/* Unsupported hint (subtle) */}
              {!isSupported && (
                <div className="mt-2 text-[11px] text-warning flex items-start gap-1.5">
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
