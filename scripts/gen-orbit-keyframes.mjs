const [P1X,P1Y,P2X,P2Y] = [0.35, 0.25, 0.6, 1];
const bez = (t,a,b) => 3*(1-t)**2*t*a + 3*(1-t)*t*t*b + t**3;
const solve = (u) => { let lo=0, hi=1;
  for (let i=0;i<60;i++){ const m=(lo+hi)/2; (bez(m,P1X,P2X) < u ? lo=m : hi=m); } return (lo+hi)/2; };
const ease = (u) => bez(solve(u), P1Y, P2Y);

// Depth as a function of PATH POSITION p, not time.
// p=0 left · p=.25 top (far) · p=.5 right · p=.75 bottom (near)
const scaleAt   = (p) => 0.85 - 0.15 * Math.sin(2*Math.PI*p);
const opacityAt = (p) => 0.75 - 0.25 * Math.sin(2*Math.PI*p);

const stops = Array.from({length:21}, (_,i) => i*5);
const line = (s, body) => `  ${s}% { ${body} }`;
console.log("@keyframes orion-travel {");
console.log(stops.map(s => line(s, `offset-distance: ${(ease(s/100)*100).toFixed(2)}%;`)).join("\n"));
console.log("}\n");
console.log("@keyframes orion-depth {");
console.log(stops.map(s => { const p = ease(s/100);
  return line(s, `transform: scale(${scaleAt(p).toFixed(3)}); opacity: ${opacityAt(p).toFixed(3)};`); }).join("\n"));
console.log("}");
