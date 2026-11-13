import { format } from "d3";

export const AWARDS = {
  1: { name: "Gold", color: "#c9a227" },
  2: { name: "Silver", color: "#8a96a3" },
  3: { name: "Bronze", color: "#b4733f" },
  4: { name: "Podium", color: "#497cae" },
  5: { name: "Podium", color: "#497cae" },
};

const TROPHY_PATH = "M7 2h10v2h4v3a5 5 0 0 1-4.6 5 5 5 0 0 1-3.4 3.4V18h3v3H8v-3h3v-2.6A5 5 0 0 1 7.6 12 5 5 0 0 1 3 7V4h4V2zm0 4H5v1a3 3 0 0 0 2 2.8V6zm10 0v3.8A3 3 0 0 0 19 7V6h-2z";
export const fmt = format(",");
export const capitalize = (value) => value ? value[0].toUpperCase() + value.slice(1) : value;

export function Trophy({ color, label }) {
  return <svg viewBox="0 0 24 24" className="trophy" role="img" aria-label={label}
    aria-hidden={label ? undefined : true} style={{ color }}>
    <path d={TROPHY_PATH} fill="currentColor" />
  </svg>;
}

export function Facts({ facts, id, className = "" }) {
  return <dl id={id} className={`facts ${className}`.trim()} style={{ "--cols": facts.length }}>
    {facts.map(({ label, value, note, primary, accent }) =>
      <div key={label} className={primary ? "fact primary" : "fact"}
        style={accent ? { "--accent": accent } : undefined}>
        <dt>{label}</dt><dd>{value}</dd>{note && <span className="fact-note">{note}</span>}
      </div>)}
  </dl>;
}
