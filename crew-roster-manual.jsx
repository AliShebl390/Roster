import { useState } from "react";

const MIN_REST_HOURS = 14;

const T = {
  navy: "#0A1628",
  gold: "#C8A95A",
  lightGold: "#E8D5A3",
  skyBlue: "#4A90D9",
  white: "#F8F9FF",
  danger: "#E53E3E",
  warning: "#DD6B20",
  success: "#2F855A",
  cardBg: "#0F2040",
  border: "#1E3A5F",
};

const DAYS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

function parseTime(str) {
  if (!str) return null;
  const clean = String(str).replace(/[^\d]/g, "");
  if (!clean) return null;
  const norm = clean.length <= 2 ? clean.padStart(4, "0") : clean.padStart(4, "0").slice(-4);
  const h = parseInt(norm.slice(0, 2), 10);
  const m = parseInt(norm.slice(2), 10);
  if (isNaN(h) || isNaN(m) || h > 23 || m > 59) return null;
  return h * 60 + m;
}

function minutesToHHMM(mins) {
  if (mins === null || mins === undefined || isNaN(mins)) return "—";
  if (mins < 0) mins += 1440;
  return `${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, "0")}m`;
}

function parseRosterDate(str) {
  if (!str) return null;
  const parts = str.trim().split("-");
  if (parts.length !== 3) return null;
  const dd = Number(parts[0]), mm = Number(parts[1]), yyyy = Number(parts[2]);
  if (yyyy < 1900 || mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;
  const d = new Date(Date.UTC(yyyy, mm - 1, dd));
  if (d.getUTCFullYear() !== yyyy || d.getUTCMonth() !== mm - 1 || d.getUTCDate() !== dd) return null;
  return d;
}

// Convert YYYY-MM-DD (from <input type="date">) to DD-MM-YYYY
function toRosterDate(iso) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  return `${d}-${m}-${y}`;
}

// Get day abbreviation from YYYY-MM-DD
function getDayAbbr(iso) {
  if (!iso) return "";
  return DAYS[new Date(iso + "T00:00:00Z").getUTCDay()];
}

// Convert HH:MM (from <input type="time">) to HHMM string
function toHHMM(timeValue) {
  return timeValue ? timeValue.replace(":", "") : "";
}

let nextId = 1;
function emptyEntry() {
  return { id: nextId++, date: "", route: "", departFlight: "", departTime: "", arriveFlight: "", arriveTime: "" };
}

function calculateRest(entries) {
  const flights = entries
    .map((e) => {
      const rosterDate = toRosterDate(e.date);
      const dateObj = parseRosterDate(rosterDate);
      const departMin = parseTime(toHHMM(e.departTime));
      return {
        date: rosterDate,
        day: getDayAbbr(e.date),
        route: e.route.trim(),
        departFlight: e.departFlight.trim(),
        departTime: toHHMM(e.departTime),
        arriveFlight: e.arriveFlight.trim(),
        arriveTime: toHHMM(e.arriveTime),
        hasDepart: Boolean(e.departFlight || e.departTime),
        hasArrive: Boolean(e.arriveFlight || e.arriveTime),
        _dateObj: dateObj,
        _departMin: departMin,
      };
    })
    .filter((f) => f._dateObj && (f.hasDepart || f.hasArrive))
    .sort((a, b) => {
      const at = a._dateObj.getTime(), bt = b._dateObj.getTime();
      if (at !== bt) return at - bt;
      return (a._departMin ?? Infinity) - (b._departMin ?? Infinity);
    });

  const analyzed = [];
  for (const curr of flights) {
    const prev = analyzed[analyzed.length - 1];
    let restFromPrev = null, restViolation = false, restWarning = false;

    if (prev?.hasArrive && prev.arriveTime && curr.hasDepart && curr.departTime) {
      const prevArrMin = parseTime(prev.arriveTime);
      const currDepMin = parseTime(curr.departTime);
      if (prevArrMin !== null && currDepMin !== null && prev._dateObj && curr._dateObj) {
        const dayDiff = Math.round((curr._dateObj - prev._dateObj) / 86400000);
        const gap = currDepMin - prevArrMin + dayDiff * 1440;
        if (gap >= 0) {
          restFromPrev = gap;
          const hrs = gap / 60;
          restViolation = hrs < MIN_REST_HOURS;
          restWarning = hrs >= MIN_REST_HOURS && hrs < MIN_REST_HOURS + 2;
        }
      }
    }
    analyzed.push({ ...curr, restFromPrev, restViolation, restWarning });
  }
  return analyzed;
}

const inputStyle = {
  background: "rgba(255,255,255,0.05)",
  border: `1px solid ${T.border}`,
  borderRadius: "6px",
  color: T.white,
  padding: "7px 10px",
  fontSize: "13px",
  width: "100%",
  outline: "none",
};

const labelStyle = {
  fontSize: "10px",
  color: "#8899AA",
  letterSpacing: "1px",
  marginBottom: "4px",
  display: "block",
};

export default function CrewRosterManual() {
  const [crewName, setCrewName] = useState("");
  const [period, setPeriod] = useState("");
  const [entries, setEntries] = useState([emptyEntry()]);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const update = (id, field, value) =>
    setEntries((prev) => prev.map((e) => (e.id === id ? { ...e, [field]: value } : e)));

  const addEntry = () => setEntries((prev) => [...prev, emptyEntry()]);

  const removeEntry = (id) =>
    setEntries((prev) => (prev.length > 1 ? prev.filter((e) => e.id !== id) : prev));

  const handleCalculate = () => {
    setError(null);
    const hasAny = entries.some((e) => e.date && (e.departTime || e.arriveTime));
    if (!hasAny) {
      setError("Please enter at least one flight with a date and a departure or arrival time.");
      return;
    }
    const flights = calculateRest(entries);
    if (flights.length === 0) {
      setError("No valid flights found. Make sure each row has a date and at least one time.");
      return;
    }
    setResult({ crewName: crewName.trim() || "Unknown", period: period.trim(), flights });
  };

  const violations = result?.flights.filter((f) => f.restViolation) ?? [];
  const warnings = result?.flights.filter((f) => f.restWarning) ?? [];
  const safe = result?.flights.filter((f) => f.restFromPrev !== null && !f.restViolation && !f.restWarning) ?? [];

  return (
    <div style={{
      minHeight: "100vh",
      background: `linear-gradient(135deg, ${T.navy} 0%, #0D1F3C 50%, #091525 100%)`,
      fontFamily: "'Georgia', 'Times New Roman', serif",
      color: T.white,
      padding: 0,
    }}>
      {/* Header */}
      <div style={{
        background: `linear-gradient(90deg, ${T.navy} 0%, #0F2040 100%)`,
        borderBottom: `2px solid ${T.gold}`,
        padding: "20px 32px",
        display: "flex", alignItems: "center", gap: "16px",
      }}>
        <div style={{
          width: 48, height: 48,
          background: `linear-gradient(135deg, ${T.gold}, ${T.lightGold})`,
          borderRadius: "50%",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 22,
        }}>✈️</div>
        <div>
          <div style={{ fontSize: 22, fontWeight: "bold", color: T.gold, letterSpacing: 2 }}>
            CREW ROSTER ANALYZER
          </div>
          <div style={{ fontSize: 12, color: T.skyBlue, letterSpacing: 3, textTransform: "uppercase" }}>
            Manual Entry · Rest Period Calculator
          </div>
        </div>
        <div style={{ marginLeft: "auto", textAlign: "right" }}>
          <div style={{ fontSize: 11, color: T.lightGold, opacity: 0.8 }}>Minimum Rest Rule</div>
          <div style={{ fontSize: 20, fontWeight: "bold", color: T.gold }}>14 Hours</div>
        </div>
      </div>

      <div style={{ padding: "32px", maxWidth: 1000, margin: "0 auto" }}>

        {/* Crew Info */}
        <div style={{
          background: T.cardBg, borderRadius: 12, padding: "20px 24px",
          border: `1px solid ${T.border}`, marginBottom: 24,
          display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16,
        }}>
          <div>
            <label style={labelStyle}>CREW NAME</label>
            <input
              style={inputStyle}
              placeholder="e.g. Ahmed Hassan"
              value={crewName}
              onChange={(e) => setCrewName(e.target.value)}
            />
          </div>
          <div>
            <label style={labelStyle}>ROSTER PERIOD</label>
            <input
              style={inputStyle}
              placeholder="e.g. June 2025"
              value={period}
              onChange={(e) => setPeriod(e.target.value)}
            />
          </div>
        </div>

        {/* Flight Entry Table */}
        <div style={{
          background: T.cardBg, borderRadius: 12,
          border: `1px solid ${T.border}`, overflow: "hidden", marginBottom: 24,
        }}>
          <div style={{
            padding: "16px 24px", borderBottom: `1px solid ${T.border}`,
            color: T.gold, fontWeight: "bold", fontSize: 14, letterSpacing: 2,
          }}>
            ✏️ ENTER FLIGHT SCHEDULE
          </div>

          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ background: "rgba(200,169,90,0.08)" }}>
                  {["Date", "Route", "Dep Flight", "STD", "Arr Flight", "STA", ""].map((h, i) => (
                    <th key={i} style={{
                      padding: "10px 12px", textAlign: "left", color: T.lightGold,
                      fontSize: 11, letterSpacing: 1, fontWeight: "normal",
                      borderBottom: `1px solid ${T.border}`,
                      whiteSpace: "nowrap",
                    }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {entries.map((e, idx) => (
                  <tr key={e.id} style={{ borderBottom: `1px solid ${T.border}22` }}>
                    {/* Date */}
                    <td style={{ padding: "8px 12px", minWidth: 150 }}>
                      <input
                        type="date"
                        style={{ ...inputStyle, colorScheme: "dark" }}
                        value={e.date}
                        onChange={(ev) => update(e.id, "date", ev.target.value)}
                      />
                      {e.date && (
                        <div style={{ fontSize: 10, color: T.skyBlue, marginTop: 2 }}>
                          {getDayAbbr(e.date)}
                        </div>
                      )}
                    </td>
                    {/* Route */}
                    <td style={{ padding: "8px 12px", minWidth: 110 }}>
                      <input
                        style={inputStyle}
                        placeholder="CAI ASW"
                        value={e.route}
                        onChange={(ev) => update(e.id, "route", ev.target.value)}
                      />
                    </td>
                    {/* Dep Flight */}
                    <td style={{ padding: "8px 12px", minWidth: 110 }}>
                      <input
                        style={inputStyle}
                        placeholder="MS 284"
                        value={e.departFlight}
                        onChange={(ev) => update(e.id, "departFlight", ev.target.value)}
                      />
                    </td>
                    {/* STD */}
                    <td style={{ padding: "8px 12px", minWidth: 120 }}>
                      <input
                        type="time"
                        style={{ ...inputStyle, colorScheme: "dark" }}
                        value={e.departTime}
                        onChange={(ev) => update(e.id, "departTime", ev.target.value)}
                      />
                    </td>
                    {/* Arr Flight */}
                    <td style={{ padding: "8px 12px", minWidth: 110 }}>
                      <input
                        style={inputStyle}
                        placeholder="MS 285"
                        value={e.arriveFlight}
                        onChange={(ev) => update(e.id, "arriveFlight", ev.target.value)}
                      />
                    </td>
                    {/* STA */}
                    <td style={{ padding: "8px 12px", minWidth: 120 }}>
                      <input
                        type="time"
                        style={{ ...inputStyle, colorScheme: "dark" }}
                        value={e.arriveTime}
                        onChange={(ev) => update(e.id, "arriveTime", ev.target.value)}
                      />
                    </td>
                    {/* Remove */}
                    <td style={{ padding: "8px 12px", textAlign: "center" }}>
                      <button
                        onClick={() => removeEntry(e.id)}
                        disabled={entries.length === 1}
                        style={{
                          background: "transparent",
                          color: entries.length === 1 ? "#333" : "#E53E3E",
                          border: "none", cursor: entries.length === 1 ? "default" : "pointer",
                          fontSize: 18, padding: "4px 8px", borderRadius: 6,
                          lineHeight: 1,
                        }}
                        title="Remove row"
                      >✕</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Add row + Calculate */}
          <div style={{
            padding: "16px 24px", borderTop: `1px solid ${T.border}`,
            display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap",
          }}>
            <button
              onClick={addEntry}
              style={{
                background: "transparent",
                color: T.skyBlue,
                border: `1px solid ${T.skyBlue}`,
                borderRadius: 8, padding: "9px 20px",
                cursor: "pointer", fontSize: 13,
              }}
            >
              + Add Flight
            </button>
            <button
              onClick={handleCalculate}
              style={{
                background: `linear-gradient(135deg, ${T.gold}, #A07840)`,
                color: T.navy, border: "none", borderRadius: 8,
                padding: "10px 28px", fontWeight: "bold", fontSize: 14,
                cursor: "pointer", letterSpacing: 1,
              }}
            >
              🔍 Calculate Rest Periods
            </button>
            {result && (
              <button
                onClick={() => { setResult(null); setError(null); }}
                style={{
                  background: "transparent", color: "#8899AA",
                  border: `1px solid #8899AA44`, borderRadius: 8,
                  padding: "9px 16px", cursor: "pointer", fontSize: 12,
                }}
              >
                Clear Results
              </button>
            )}
          </div>
        </div>

        {/* Error */}
        {error && (
          <div style={{
            background: "rgba(229,62,62,0.1)", border: "1px solid #E53E3E",
            borderRadius: 12, padding: "16px 20px", marginBottom: 24, color: "#FC8181", fontSize: 13,
          }}>
            ❌ {error}
          </div>
        )}

        {/* Results */}
        {result && (
          <>
            {/* Summary Cards */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16, marginBottom: 24 }}>
              {[
                { label: "REST VIOLATIONS", value: violations.length, color: T.danger, icon: "🚨", sub: "< 14 hrs rest" },
                { label: "BORDERLINE", value: warnings.length, color: T.warning, icon: "⚠️", sub: "14–16 hrs rest" },
                { label: "COMPLIANT", value: safe.length, color: T.success, icon: "✅", sub: "> 16 hrs rest" },
              ].map((card) => (
                <div key={card.label} style={{
                  background: T.cardBg, borderRadius: 12, padding: 20,
                  border: `1px solid ${card.color}44`, textAlign: "center",
                }}>
                  <div style={{ fontSize: 28, marginBottom: 4 }}>{card.icon}</div>
                  <div style={{ fontSize: 32, fontWeight: "bold", color: card.color }}>{card.value}</div>
                  <div style={{ fontSize: 11, color: T.lightGold, letterSpacing: 2 }}>{card.label}</div>
                  <div style={{ fontSize: 11, color: "#8899AA", marginTop: 4 }}>{card.sub}</div>
                </div>
              ))}
            </div>

            {/* Crew / Period / Count */}
            <div style={{
              background: T.cardBg, borderRadius: 12, padding: "16px 24px",
              border: `1px solid ${T.border}`, marginBottom: 24,
              display: "flex", gap: 32, alignItems: "center", flexWrap: "wrap",
            }}>
              <div>
                <div style={{ fontSize: 11, color: "#8899AA", letterSpacing: 2 }}>CREW NAME</div>
                <div style={{ color: T.gold, fontWeight: "bold" }}>{result.crewName}</div>
              </div>
              <div>
                <div style={{ fontSize: 11, color: "#8899AA", letterSpacing: 2 }}>ROSTER PERIOD</div>
                <div style={{ color: T.gold, fontWeight: "bold" }}>{result.period || "—"}</div>
              </div>
              <div>
                <div style={{ fontSize: 11, color: "#8899AA", letterSpacing: 2 }}>TOTAL FLIGHT DAYS</div>
                <div style={{ color: T.gold, fontWeight: "bold" }}>{result.flights.length}</div>
              </div>
            </div>

            {/* Flight Table */}
            <div style={{
              background: T.cardBg, borderRadius: 12,
              border: `1px solid ${T.border}`, overflow: "hidden", marginBottom: 24,
            }}>
              <div style={{
                padding: "16px 24px", borderBottom: `1px solid ${T.border}`,
                color: T.gold, fontWeight: "bold", fontSize: 14, letterSpacing: 2,
              }}>
                📅 FLIGHT SCHEDULE & REST ANALYSIS
              </div>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                  <thead>
                    <tr style={{ background: "rgba(200,169,90,0.08)" }}>
                      {["Date", "Day", "Route", "Dep Flight", "STD", "Arr Flight", "STA", "Rest Period", "Status"].map((h) => (
                        <th key={h} style={{
                          padding: "10px 12px", textAlign: "left", color: T.lightGold,
                          fontSize: 11, letterSpacing: 1, fontWeight: "normal",
                          borderBottom: `1px solid ${T.border}`,
                        }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {result.flights.map((f, i) => {
                      const bg = f.restViolation
                        ? "rgba(229,62,62,0.08)"
                        : f.restWarning ? "rgba(221,107,32,0.08)" : "transparent";
                      const sc = f.restViolation ? T.danger : f.restWarning ? T.warning
                        : f.restFromPrev !== null ? T.success : "#8899AA";
                      const st = f.restViolation ? "🚨 VIOLATION"
                        : f.restWarning ? "⚠️ BORDERLINE"
                        : f.restFromPrev !== null ? "✅ OK" : "—";
                      return (
                        <tr key={i} style={{ background: bg, borderBottom: `1px solid ${T.border}22` }}>
                          <td style={{ padding: "10px 12px", color: T.white }}>{f.date}</td>
                          <td style={{ padding: "10px 12px", color: "#8899AA" }}>{f.day}</td>
                          <td style={{ padding: "10px 12px", color: T.skyBlue, fontWeight: "bold" }}>{f.route || "—"}</td>
                          <td style={{ padding: "10px 12px", color: T.lightGold }}>{f.departFlight || "—"}</td>
                          <td style={{ padding: "10px 12px", color: T.white }}>{f.departTime || "—"}</td>
                          <td style={{ padding: "10px 12px", color: T.lightGold }}>{f.arriveFlight || "—"}</td>
                          <td style={{ padding: "10px 12px", color: T.white }}>{f.arriveTime || "—"}</td>
                          <td style={{ padding: "10px 12px", color: sc, fontWeight: f.restFromPrev !== null ? "bold" : "normal" }}>
                            {f.restFromPrev !== null ? minutesToHHMM(f.restFromPrev) : "—"}
                          </td>
                          <td style={{ padding: "10px 12px", color: sc, fontSize: 12, fontWeight: "bold" }}>{st}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Violations Detail */}
            {violations.length > 0 && (
              <div style={{
                background: "rgba(229,62,62,0.06)", border: `1px solid ${T.danger}55`,
                borderRadius: 12, padding: "20px 24px", marginBottom: 16,
              }}>
                <div style={{ color: T.danger, fontWeight: "bold", marginBottom: 12, fontSize: 14 }}>
                  🚨 REST VIOLATIONS — ACTION REQUIRED
                </div>
                {violations.map((f, i) => (
                  <div key={i} style={{
                    background: "rgba(229,62,62,0.08)", borderRadius: 8, padding: "12px 16px",
                    marginBottom: 8, fontSize: 13,
                  }}>
                    <strong style={{ color: T.danger }}>{f.date} ({f.day})</strong>
                    <span style={{ color: "#FC8181", marginLeft: 12 }}>
                      {f.route} — Only {minutesToHHMM(f.restFromPrev)} rest before this flight. Minimum required: 14h 00m.
                    </span>
                  </div>
                ))}
              </div>
            )}

            {/* All clear */}
            {violations.length === 0 && warnings.length === 0 && result.flights.length > 0 && (
              <div style={{
                background: "rgba(47,133,90,0.1)", border: `1px solid ${T.success}55`,
                borderRadius: 12, padding: "20px 24px", textAlign: "center",
              }}>
                <div style={{ fontSize: 32, marginBottom: 8 }}>🎉</div>
                <div style={{ color: T.success, fontWeight: "bold", fontSize: 16 }}>
                  All rest periods comply with the 14-hour rule!
                </div>
              </div>
            )}
          </>
        )}

        <div style={{ textAlign: "center", marginTop: 32, color: "#4A5568", fontSize: 12 }}>
          Based on 14-hour minimum rest rule between flights · For reference only
        </div>
      </div>

      <style>{`
        * { box-sizing: border-box; }
        input[type="date"]::-webkit-calendar-picker-indicator,
        input[type="time"]::-webkit-calendar-picker-indicator { filter: invert(0.6); cursor: pointer; }
        ::-webkit-scrollbar { width: 6px; height: 6px; }
        ::-webkit-scrollbar-track { background: #0A1628; }
        ::-webkit-scrollbar-thumb { background: #1E3A5F; border-radius: 3px; }
      `}</style>
    </div>
  );
}
