// Smoke test: exercise every accessory's draw path end-to-end against a mock
// 2D context, so we catch runtime errors / bad dispatch without a real canvas.
import { drawBlob } from "../lib/client/render/draw";
import { ACCESSORIES } from "../lib/shared/accessories";

function makeCtx() {
  const calls: Record<string, number> = {};
  const grad = { addColorStop() {} };
  const handler: ProxyHandler<any> = {
    get(target, prop: string) {
      if (prop in target) return target[prop];
      if (prop === "createLinearGradient" || prop === "createRadialGradient") return () => grad;
      if (prop === "measureText") return () => ({ width: 10 });
      if (prop === "getImageData") return () => ({ data: [] });
      // any other method: count it and no-op
      return (...args: unknown[]) => {
        calls[prop] = (calls[prop] ?? 0) + 1;
        void args;
      };
    },
    set(target, prop: string, value) {
      target[prop] = value;
      return true;
    },
  };
  const ctx = new Proxy({ calls } as any, handler);
  return ctx as unknown as CanvasRenderingContext2D & { calls: Record<string, number> };
}

let failures = 0;
console.log("Accessory draw — every cosmetic renders without throwing\n");

// Try each accessory across a few representative body shapes.
const shapes = ["nana" /* banana shape */, "koala" /* round + ears */, "plum"];
for (const acc of ACCESSORIES) {
  for (const charId of shapes) {
    const ctx = makeCtx();
    try {
      drawBlob(ctx, charId, 100, 100, {
        time: 0,
        anim: "idle",
        accessories: [acc.id],
        number: 7,
        name: "Test",
      });
    } catch (e) {
      failures++;
      console.log(`  ✗ ${acc.id} (${acc.kind}) on ${charId}: ${(e as Error).message}`);
    }
  }
  // Did the draw actually paint something? (fill or stroke called)
  const ctx = makeCtx();
  drawBlob(ctx, "koala", 100, 100, { time: 0, anim: "idle", accessories: [acc.id] });
  const painted = (ctx.calls.fill ?? 0) + (ctx.calls.stroke ?? 0);
  if (painted > 0) console.log(`  ✓ ${acc.id.padEnd(10)} ${acc.kind.padEnd(13)} (${painted} paint ops)`);
  else {
    failures++;
    console.log(`  ✗ ${acc.id} (${acc.kind}) painted nothing`);
  }
}

// Full ensemble: one of each slot at once must also be fine.
try {
  const ctx = makeCtx();
  drawBlob(ctx, "koala", 100, 100, {
    time: 0,
    anim: "idle",
    accessories: ["crown", "aviators", "bowtie", "spotnana"],
  });
  console.log("\n  ✓ full ensemble (crown + aviators + bowtie + spotted banana)");
} catch (e) {
  failures++;
  console.log(`\n  ✗ full ensemble: ${(e as Error).message}`);
}

if (failures) {
  console.log(`\nAccessory draw FAILED (${failures}).`);
  process.exit(1);
}
console.log("\nAccessory draw OK.");
