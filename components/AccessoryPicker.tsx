"use client";
import { useGame, net } from "@/lib/client/net";
import {
  ACCESSORIES,
  ACCESSORY_SLOTS,
  toggleEquip,
  type AccessorySlot,
} from "@/lib/shared/accessories";
import { CURRENCY_ICON } from "@/lib/shared/constants";
import { BlobAvatar } from "./BlobAvatar";
import { audio } from "@/lib/client/audio";
import { buyCosmetic } from "@/lib/client/cosmetics";

const SLOT_LABEL: Record<AccessorySlot, string> = {
  head: "🎩 Hats",
  eyes: "🕶️ Eyewear",
  neck: "🧣 Neckwear",
  ear: "🌸 Behind the Ear",
};

// Buy + equip cosmetics that ride over your chosen blob. One item per slot, so a
// hat, shades, a bandana and an ear-flower can all stack. Each tile previews the
// item on YOUR current blob, so you see exactly how silly you'll die looking.
export function AccessoryPicker({ size = 52 }: { size?: number }) {
  const characterId = useGame((s) => s.characterId);
  const equipped = useGame((s) => s.accessories);
  const profile = useGame((s) => s.profile);
  const owned = new Set(profile?.unlocked ?? []);
  const equippedSet = new Set(equipped);

  async function onTile(id: string) {
    audio.sfx("blip");
    if (owned.has(id)) {
      net.setAccessories(toggleEquip(equipped, id)); // wear / take off
    } else {
      const got = await buyCosmetic(id);
      if (got) net.setAccessories(toggleEquip(equipped, id)); // auto-wear on purchase
    }
  }

  return (
    <div className="apicker">
      {ACCESSORY_SLOTS.map((slot) => (
        <div key={slot} className="aslot">
          <div className="aslot-label">{SLOT_LABEL[slot]}</div>
          <div className="astrip scroll">
            {ACCESSORIES.filter((a) => a.slot === slot).map((a) => {
              const isOwned = owned.has(a.id);
              const isEquipped = equippedSet.has(a.id);
              return (
                <button
                  key={a.id}
                  className={`acell ${isEquipped ? "sel" : ""} ${isOwned ? "" : "locked"}`}
                  title={isOwned ? a.catchphrase : `Buy ${a.name} — ${a.price} ${CURRENCY_ICON}. Looking good is no defense.`}
                  onClick={() => onTile(a.id)}
                >
                  <div className="av">
                    <div style={{ filter: isOwned ? "none" : "grayscale(1) brightness(0.6)" }}>
                      <BlobAvatar characterId={characterId} size={size} accessories={[a.id]} />
                    </div>
                    {!isOwned && <span className="lock-glyph">🔒</span>}
                    {isEquipped && <span className="eq-glyph">✓</span>}
                  </div>
                  <div className="acell-name">{a.name}</div>
                  {!isOwned ? (
                    <div className="acell-price">
                      {a.price}
                      {CURRENCY_ICON}
                    </div>
                  ) : isEquipped ? (
                    <div className="acell-on">WORN</div>
                  ) : (
                    <div className="tiny dim">tap to wear</div>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      ))}
      <div className="picker-hint tiny dim">
        🔒 Tap a locked item to buy it with {CURRENCY_ICON} Marbles. Mix one per slot — a hat, shades,
        a bandana and a little something behind the ear. It won't save you. You'll look incredible.
      </div>
      <style jsx>{`
        .apicker {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        .aslot-label {
          font-family: var(--font-body);
          font-size: 0.66rem;
          font-weight: 800;
          text-transform: uppercase;
          letter-spacing: 1px;
          color: var(--ink-dim);
          margin-top: 4px;
        }
        .astrip {
          display: flex;
          gap: 8px;
          overflow-x: auto;
          padding: 4px 2px 8px;
          max-width: 100%;
        }
        .acell {
          flex: 0 0 auto;
          width: 96px;
          background: rgba(0, 0, 0, 0.25);
          border: 2px solid var(--line);
          border-radius: 14px;
          padding: 6px 5px;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 3px;
          transition: transform 0.1s, border-color 0.1s;
          color: var(--ink);
          cursor: pointer;
        }
        .acell:hover {
          transform: translateY(-3px);
        }
        .acell.sel {
          border-color: var(--teal);
          background: rgba(31, 227, 194, 0.16);
          box-shadow: 0 0 0 2px rgba(31, 227, 194, 0.3);
        }
        .acell.locked {
          border-style: dashed;
        }
        .acell.locked:hover {
          border-color: var(--yellow);
        }
        .av {
          position: relative;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .lock-glyph {
          position: absolute;
          inset: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 1.1rem;
          filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.7));
          pointer-events: none;
        }
        .eq-glyph {
          position: absolute;
          top: -2px;
          right: -2px;
          font-size: 0.7rem;
          font-weight: 800;
          color: #06241f;
          background: var(--teal);
          border-radius: 999px;
          width: 16px;
          height: 16px;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .acell-name {
          font-family: var(--font-display);
          font-size: 0.72rem;
          font-weight: 700;
          text-align: center;
          line-height: 1.1;
          min-height: 2.2em;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .acell-price {
          font-size: 0.62rem;
          font-weight: 700;
          color: var(--yellow);
          background: var(--bg-2);
          border: 1px solid var(--yellow);
          border-radius: 8px;
          padding: 1px 6px;
          white-space: nowrap;
        }
        .acell-on {
          font-size: 0.6rem;
          font-weight: 800;
          color: var(--teal);
          letter-spacing: 1px;
        }
        .picker-hint {
          margin: 2px 2px 0;
          line-height: 1.3;
        }
      `}</style>
    </div>
  );
}
