import { useMemo, useState, useRef } from "react";

const MIN_REST_HOURS = 14;

const AIRLINE_THEME = {
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

function parseTime(timeStr) {
  if (!timeStr) return null;
  const clean = String(timeStr).replace(/[^\d]/g, "").trim();
  if (!clean) return null;
  const normalized = clean.length <= 2 ? clean.padStart(4, "0") : clean.padStart(4, "0").slice(-4);
  const h = parseInt(normalized.slice(0, 2), 10);
  const m = parseInt(normalized.slice(2), 10);
  if (Number.isNaN(h) || Number.isNaN(m) || h < 0 || h > 23 || m < 0 || m > 59) return null;
  return h * 60 + m;
}

function minutesToHHMM(mins) {
  if (mins === null || mins === undefined || Number.isNaN(mins)) return "—";
  if (mins < 0) mins += 1440;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${h}h ${m.toString().padStart(2, "0")}m`;
}

function parseRosterDate(dateStr) {
  if (!dateStr || typeof dateStr !== "string") return null;
  const parts = dateStr.trim().split("-");
  if (parts.length !== 3) return null;
  const [ddStr, mmStr, yyyyStr] = parts;
  const dd = Number(ddStr);
  const mm = Number(mmStr);
  const yyyy = Number(yyyyStr);
  if (!Number.isInteger(dd) || !Number.isInteger(mm) || !Number.isInteger(yyyy)) return null;
  if (yyyy < 1900 || mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;
  const utc = Date.UTC(yyyy, mm - 1, dd);
  const d = new Date(utc);
  if (d.getUTCFullYear() !== yyyy || d.getUTCMonth() !== mm - 1 || d.getUTCDate() !== dd) return null;
  return d;
}

function safeFlightString(value) {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function normalizeFlight(rawFlight) {
  const date = safeFlightString(rawFlight?.date);
  const day = safeFlightString(rawFlight?.day).toUpperCase();
  const route = safeFlightString(rawFlight?.route);
  const type = safeFlightString(rawFlight?.type);
  const departFlight = safeFlightString(rawFlight?.departFlight);
  const departTime = safeFlightString(rawFlight?.departTime);
  const arriveFlight = safeFlightString(rawFlight?.arriveFlight);
  const arriveTime = safeFlightString(rawFlight?.arriveTime);
  const hasDepart = Boolean(rawFlight?.hasDepart || departFlight || departTime);
  const hasArrive = Boolean(rawFlight?.hasArrive || arriveFlight || arriveTime);
  const dateObj = parseRosterDate(date);
  const departMin = parseTime(departTime);
  return {
    date,
    day,
    route,
    type,
    departFlight,
    departTime,
    arriveFlight,
    arriveTime,
    hasDepart,
    hasArrive,
    _dateObj: dateObj,
    _departMin: departMin,
  };
}

function sortFlightsByDateAndDeparture(flights) {
  return [...flights].sort((a, b) => {
    const at = a._dateObj ? a._dateObj.getTime() : Number.MAX_SAFE_INTEGER;
    const bt = b._dateObj ? b._dateObj.getTime() : Number.MAX_SAFE_INTEGER;
    if (at !== bt) return at - bt;
    const ad = a._departMin ?? Number.MAX_SAFE_INTEGER;
    const bd = b._departMin ?? Number.MAX_SAFE_INTEGER;
    return ad - bd;
  });
}

export default function CrewRosterAnalyzer() {
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [previewMediaType, setPreviewMediaType] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const fileRef = useRef();

  const handleFile = (f) => {
    if (!f) return;
    const allowed = /^image\//.test(f.type) || f.type === "application/pdf";
    if (!allowed) {
      setError("Please upload an image or PDF roster file.");
      return;
    }
    setFile(f);
    setResult(null);
    setError(null);
    setPreviewMediaType(f.type || "");
    const reader = new FileReader();
    reader.onload = (e) => setPreview(e.target.result);
    reader.readAsDataURL(f);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    const f = e.dataTransfer.files[0];
    if (f) handleFile(f);
  };

  const analyze = async () => {
    if (!file || !preview) return;
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const base64Data = preview.split(",")[1];
      const mediaType = file.type || "image/jpeg";

      const systemPrompt = `You are an aviation roster analysis expert. Extract flight data from cabin crew roster images and return ONLY a valid JSON object. No markdown, no explanation, just raw JSON.

The JSON must have this exact structure:
{
  "crewName": "string or Unknown",
  "period": "string",
  "flights": [
    {
      "date": "DD-MM-YYYY",
      "day": "MON/TUE/etc",
      "route": "e.g. CAI ASW",
      "type": "e.g. B800",
      "departFlight": "e.g. MS 284",
      "departTime": "HHMM as string e.g. 1635",
      "arriveFlight": "e.g. MS 285",
      "arriveTime": "HHMM as string e.g. 2010",
      "hasDepart": true/false,
      "hasArrive": true/false
    }
  ]
}

Only include rows that have at least one flight. Skip empty days. Times should be 4-digit strings like "0650", "2130", "0010".`;

      const anthropicKey = window?.ANTHROPIC_API_KEY || import.meta?.env?.VITE_ANTHROPIC_API_KEY;
      if (!anthropicKey) {
        throw new Error("Missing Anthropic API key. Set window.ANTHROPIC_API_KEY or VITE_ANTHROPIC_API_KEY.");
      }

      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": anthropicKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 1000,
          system: systemPrompt,
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "image",
                  source: { type: "base64", media_type: mediaType, data: base64Data },
                },
                { type: "text", text: "Extract all flight data from this cabin crew roster. Return only the JSON." },
              ],
            },
          ],
        }),
      });
      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Anthropic request failed (${response.status}): ${errText}`);
      }

      const data = await response.json();
      const raw = data.content?.find((b) => b.type === "text")?.text || "";
      const clean = raw.replace(/```json|```/g, "").trim();
      const parsed = JSON.parse(clean);
      if (!parsed || typeof parsed !== "object") throw new Error("Parsed response is not an object.");

      // Now calculate rest periods
      const rawFlights = Array.isArray(parsed.flights) ? parsed.flights : [];
      const normalized = rawFlights
        .map(normalizeFlight)
        .filter((f) => f.date && (f.hasDepart || f.hasArrive) && f._dateObj);
      const flights = sortFlightsByDateAndDeparture(normalized);
      const analyzed = [];

      for (let i = 0; i < flights.length; i++) {
        const curr = flights[i];
        const prev = analyzed[analyzed.length - 1];

        let restFromPrev = null;
        let restViolation = false;
        let restWarning = false;

        if (prev && prev.hasArrive && prev.arriveTime && curr.hasDepart && curr.departTime) {
          const prevArriveMin = parseTime(prev.arriveTime);
          const currDepartMin = parseTime(curr.departTime);
          const prevDate = prev._dateObj || parseRosterDate(prev.date);
          const currDate = curr._dateObj || parseRosterDate(curr.date);
          if (prevDate && currDate && prevArriveMin !== null && currDepartMin !== null) {
            const dayDiff = Math.round((currDate.getTime() - prevDate.getTime()) / (1000 * 60 * 60 * 24));
            const gapMins = currDepartMin - prevArriveMin + dayDiff * 1440;
            if (gapMins >= 0) {
              restFromPrev = gapMins;
              const restHours = gapMins / 60;
              restViolation = restHours < MIN_REST_HOURS;
              restWarning = restHours >= MIN_REST_HOURS && restHours < MIN_REST_HOURS + 2;
            }
          }
        }

        analyzed.push({ ...curr, restFromPrev, restViolation, restWarning });
      }

      setResult({
        crewName: safeFlightString(parsed.crewName) || "Unknown",
        period: safeFlightString(parsed.period),
        flights: analyzed,
      });
    } catch (err) {
      setError(err?.message || "Could not analyze the roster. Please try a clearer image.");
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const canAnalyze = useMemo(() => !!file && !!preview && !loading, [file, preview, loading]);

  const violations = result?.flights?.filter((f) => f.restViolation) || [];
  const warnings = result?.flights?.filter((f) => f.restWarning) || [];
  const safe = result?.flights?.filter((f) => f.restFromPrev !== null && !f.restViolation && !f.restWarning) || [];

  return (
    <div style={{
      minHeight: "100vh",
      background: `linear-gradient(135deg, ${AIRLINE_THEME.navy} 0%, #0D1F3C 50%, #091525 100%)`,
      fontFamily: "'Georgia', 'Times New Roman', serif",
      color: AIRLINE_THEME.white,
      padding: "0",
    }}>
      {/* Header */}
      <div style={{
        background: `linear-gradient(90deg, ${AIRLINE_THEME.navy} 0%, #0F2040 100%)`,
        borderBottom: `2px solid ${AIRLINE_THEME.gold}`,
        padding: "20px 32px",
        display: "flex",
        alignItems: "center",
        gap: "16px",
      }}>
        <div style={{
          width: "48px", height: "48px",
          background: `linear-gradient(135deg, ${AIRLINE_THEME.gold}, ${AIRLINE_THEME.lightGold})`,
          borderRadius: "50%",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: "22px",
        }}>✈️</div>
        <div>
          <div style={{ fontSize: "22px", fontWeight: "bold", color: AIRLINE_THEME.gold, letterSpacing: "2px" }}>
            CREW ROSTER ANALYZER
          </div>
          <div style={{ fontSize: "12px", color: AIRLINE_THEME.skyBlue, letterSpacing: "3px", textTransform: "uppercase" }}>
            Rest Period & Flight Gap Calculator
          </div>
        </div>
        <div style={{ marginLeft: "auto", textAlign: "right" }}>
          <div style={{ fontSize: "11px", color: AIRLINE_THEME.lightGold, opacity: 0.8 }}>Minimum Rest Rule</div>
          <div style={{ fontSize: "20px", fontWeight: "bold", color: AIRLINE_THEME.gold }}>14 Hours</div>
        </div>
      </div>

      <div style={{ padding: "32px", maxWidth: "960px", margin: "0 auto" }}>

        {/* Upload Area */}
        <input ref={fileRef} type="file" accept="image/*,.pdf" style={{ display: "none" }}
          onChange={(e) => handleFile(e.target.files[0])} />
        <div
          onDrop={handleDrop}
          onDragOver={(e) => e.preventDefault()}
          style={{
            border: `2px dashed ${preview ? AIRLINE_THEME.gold : AIRLINE_THEME.border}`,
            borderRadius: "16px",
            padding: preview ? "16px" : "32px",
            textAlign: "center",
            background: preview ? "transparent" : "rgba(255,255,255,0.02)",
            transition: "all 0.3s ease",
            marginBottom: "24px",
          }}
        >
          {!preview ? (
            <>
              <div style={{ fontSize: "48px", marginBottom: "12px" }}>📋</div>
              <div style={{ fontSize: "18px", color: AIRLINE_THEME.gold, marginBottom: "8px" }}>
                Upload your roster
              </div>
              <div style={{ fontSize: "13px", color: "#8899AA", marginBottom: "20px" }}>
                Drag & drop, or click the button below
              </div>
              <button
                onClick={(e) => { e.stopPropagation(); fileRef.current?.click(); }}
                style={{
                  background: `linear-gradient(135deg, ${AIRLINE_THEME.gold}, #A07840)`,
                  color: AIRLINE_THEME.navy, border: "none", borderRadius: "8px",
                  padding: "12px 32px", fontWeight: "bold", fontSize: "15px",
                  cursor: "pointer", letterSpacing: "1px",
                }}>
                📂 Choose File
              </button>

            </>
          ) : (
            <div style={{ display: "flex", gap: "16px", alignItems: "flex-start" }}>
              {previewMediaType === "application/pdf" ? (
                <div style={{
                  height: "200px", width: "360px", borderRadius: "8px",
                  border: `1px solid ${AIRLINE_THEME.border}`, display: "flex",
                  alignItems: "center", justifyContent: "center", background: "rgba(255,255,255,0.03)",
                }}>
                  <div style={{ textAlign: "center" }}>
                    <div style={{ fontSize: "40px" }}>📄</div>
                    <div style={{ fontSize: "12px", color: "#8899AA", marginTop: "6px" }}>PDF preview unavailable</div>
                  </div>
                </div>
              ) : (
                <img src={preview} alt="Roster" style={{
                  maxHeight: "200px", maxWidth: "360px", borderRadius: "8px",
                  border: `1px solid ${AIRLINE_THEME.border}`, objectFit: "contain",
                }} />
              )}
              <div style={{ flex: 1, textAlign: "left" }}>
                <div style={{ color: AIRLINE_THEME.gold, marginBottom: "8px", fontSize: "14px" }}>✅ Roster uploaded</div>
                <div style={{ color: "#8899AA", fontSize: "12px", marginBottom: "16px" }}>{file?.name}</div>
                <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
                  <button onClick={analyze} disabled={!canAnalyze} style={{
                    background: loading ? "#333" : `linear-gradient(135deg, ${AIRLINE_THEME.gold}, #A07840)`,
                    color: loading ? "#888" : AIRLINE_THEME.navy,
                    border: "none", borderRadius: "8px", padding: "10px 24px",
                    fontWeight: "bold", fontSize: "14px", cursor: canAnalyze ? "pointer" : "not-allowed",
                    letterSpacing: "1px",
                  }}>
                    {loading ? "⏳ Analyzing..." : "🔍 Analyze Roster"}
                  </button>
                  <button onClick={() => { setFile(null); setPreview(null); setPreviewMediaType(""); setResult(null); fileRef.current?.click(); }}
                    style={{
                      background: "transparent", color: AIRLINE_THEME.skyBlue,
                      border: `1px solid ${AIRLINE_THEME.skyBlue}`, borderRadius: "8px",
                      padding: "10px 16px", cursor: "pointer", fontSize: "13px",
                    }}>
                    Change File
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Loading */}
        {loading && (
          <div style={{
            background: AIRLINE_THEME.cardBg, borderRadius: "12px", padding: "32px",
            textAlign: "center", border: `1px solid ${AIRLINE_THEME.border}`, marginBottom: "24px",
          }}>
            <div style={{ fontSize: "36px", marginBottom: "12px", animation: "spin 2s linear infinite" }}>✈️</div>
            <div style={{ color: AIRLINE_THEME.gold, fontSize: "16px" }}>Reading your roster...</div>
            <div style={{ color: "#8899AA", fontSize: "13px", marginTop: "8px" }}>
              Claude AI is extracting flights and calculating rest periods
            </div>
          </div>
        )}

        {/* Error */}
        {error && (
          <div style={{
            background: "rgba(229,62,62,0.1)", border: "1px solid #E53E3E",
            borderRadius: "12px", padding: "20px", marginBottom: "24px", color: "#FC8181",
          }}>
            ❌ {error}
          </div>
        )}

        {/* Results */}
        {result && (
          <>
            {/* Summary Cards */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "16px", marginBottom: "24px" }}>
              {[
                { label: "REST VIOLATIONS", value: violations.length, color: AIRLINE_THEME.danger, icon: "🚨", sub: "< 14 hrs rest" },
                { label: "BORDERLINE", value: warnings.length, color: AIRLINE_THEME.warning, icon: "⚠️", sub: "14-16 hrs rest" },
                { label: "COMPLIANT", value: safe.length, color: AIRLINE_THEME.success, icon: "✅", sub: "> 16 hrs rest" },
              ].map((card) => (
                <div key={card.label} style={{
                  background: AIRLINE_THEME.cardBg, borderRadius: "12px", padding: "20px",
                  border: `1px solid ${card.color}44`, textAlign: "center",
                }}>
                  <div style={{ fontSize: "28px", marginBottom: "4px" }}>{card.icon}</div>
                  <div style={{ fontSize: "32px", fontWeight: "bold", color: card.color }}>{card.value}</div>
                  <div style={{ fontSize: "11px", color: AIRLINE_THEME.lightGold, letterSpacing: "2px" }}>{card.label}</div>
                  <div style={{ fontSize: "11px", color: "#8899AA", marginTop: "4px" }}>{card.sub}</div>
                </div>
              ))}
            </div>

            {/* Period & Crew */}
            <div style={{
              background: AIRLINE_THEME.cardBg, borderRadius: "12px", padding: "16px 24px",
              border: `1px solid ${AIRLINE_THEME.border}`, marginBottom: "24px",
              display: "flex", gap: "32px", alignItems: "center",
            }}>
              <div>
                <div style={{ fontSize: "11px", color: "#8899AA", letterSpacing: "2px" }}>ROSTER PERIOD</div>
                <div style={{ color: AIRLINE_THEME.gold, fontWeight: "bold" }}>{result.period || "—"}</div>
              </div>
              <div>
                <div style={{ fontSize: "11px", color: "#8899AA", letterSpacing: "2px" }}>CREW NAME</div>
                <div style={{ color: AIRLINE_THEME.gold, fontWeight: "bold" }}>{result.crewName || "Unknown"}</div>
              </div>
              <div>
                <div style={{ fontSize: "11px", color: "#8899AA", letterSpacing: "2px" }}>TOTAL FLIGHT DAYS</div>
                <div style={{ color: AIRLINE_THEME.gold, fontWeight: "bold" }}>{result.flights.length}</div>
              </div>
            </div>

            {/* Flight Table */}
            <div style={{
              background: AIRLINE_THEME.cardBg, borderRadius: "12px",
              border: `1px solid ${AIRLINE_THEME.border}`, overflow: "hidden", marginBottom: "24px",
            }}>
              <div style={{
                padding: "16px 24px", borderBottom: `1px solid ${AIRLINE_THEME.border}`,
                color: AIRLINE_THEME.gold, fontWeight: "bold", fontSize: "14px", letterSpacing: "2px",
              }}>
                📅 FLIGHT SCHEDULE & REST ANALYSIS
              </div>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
                  <thead>
                    <tr style={{ background: "rgba(200,169,90,0.08)" }}>
                      {["Date", "Day", "Route", "Depart", "STD", "Arrive", "STA", "Rest Period", "Status"].map((h) => (
                        <th key={h} style={{
                          padding: "10px 12px", textAlign: "left", color: AIRLINE_THEME.lightGold,
                          fontSize: "11px", letterSpacing: "1px", fontWeight: "normal",
                          borderBottom: `1px solid ${AIRLINE_THEME.border}`,
                        }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {result.flights.map((f, i) => {
                      const rowBg = f.restViolation
                        ? "rgba(229,62,62,0.08)"
                        : f.restWarning
                        ? "rgba(221,107,32,0.08)"
                        : "transparent";
                      const statusColor = f.restViolation ? AIRLINE_THEME.danger
                        : f.restWarning ? AIRLINE_THEME.warning
                        : f.restFromPrev !== null ? AIRLINE_THEME.success : "#8899AA";
                      const statusText = f.restViolation ? "🚨 VIOLATION"
                        : f.restWarning ? "⚠️ BORDERLINE"
                        : f.restFromPrev !== null ? "✅ OK" : "—";

                      return (
                        <tr key={i} style={{ background: rowBg, borderBottom: `1px solid ${AIRLINE_THEME.border}22` }}>
                          <td style={{ padding: "10px 12px", color: AIRLINE_THEME.white }}>{f.date}</td>
                          <td style={{ padding: "10px 12px", color: "#8899AA" }}>{f.day}</td>
                          <td style={{ padding: "10px 12px", color: AIRLINE_THEME.skyBlue, fontWeight: "bold" }}>{f.route || "—"}</td>
                          <td style={{ padding: "10px 12px", color: AIRLINE_THEME.lightGold }}>{f.departFlight || "—"}</td>
                          <td style={{ padding: "10px 12px", color: AIRLINE_THEME.white }}>{f.departTime || "—"}</td>
                          <td style={{ padding: "10px 12px", color: AIRLINE_THEME.lightGold }}>{f.arriveFlight || "—"}</td>
                          <td style={{ padding: "10px 12px", color: AIRLINE_THEME.white }}>{f.arriveTime || "—"}</td>
                          <td style={{ padding: "10px 12px", color: statusColor, fontWeight: f.restFromPrev !== null ? "bold" : "normal" }}>
                            {f.restFromPrev !== null ? minutesToHHMM(f.restFromPrev) : "—"}
                          </td>
                          <td style={{ padding: "10px 12px", color: statusColor, fontSize: "12px", fontWeight: "bold" }}>
                            {statusText}
                          </td>
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
                background: "rgba(229,62,62,0.06)", border: `1px solid ${AIRLINE_THEME.danger}55`,
                borderRadius: "12px", padding: "20px 24px", marginBottom: "16px",
              }}>
                <div style={{ color: AIRLINE_THEME.danger, fontWeight: "bold", marginBottom: "12px", fontSize: "14px" }}>
                  🚨 REST VIOLATIONS — ACTION REQUIRED
                </div>
                {violations.map((f, i) => (
                  <div key={i} style={{
                    background: "rgba(229,62,62,0.08)", borderRadius: "8px", padding: "12px 16px",
                    marginBottom: "8px", fontSize: "13px",
                  }}>
                    <strong style={{ color: AIRLINE_THEME.danger }}>{f.date} ({f.day})</strong>
                    <span style={{ color: "#FC8181", marginLeft: "12px" }}>
                      {f.route} — Only {minutesToHHMM(f.restFromPrev)} rest before this flight. Minimum required: 14h 00m.
                    </span>
                  </div>
                ))}
              </div>
            )}

            {/* All good */}
            {violations.length === 0 && warnings.length === 0 && result.flights.length > 0 && (
              <div style={{
                background: "rgba(47,133,90,0.1)", border: `1px solid ${AIRLINE_THEME.success}55`,
                borderRadius: "12px", padding: "20px 24px", textAlign: "center",
              }}>
                <div style={{ fontSize: "32px", marginBottom: "8px" }}>🎉</div>
                <div style={{ color: AIRLINE_THEME.success, fontWeight: "bold", fontSize: "16px" }}>
                  All rest periods comply with the 14-hour rule!
                </div>
              </div>
            )}
          </>
        )}

        {/* Footer note */}
        <div style={{ textAlign: "center", marginTop: "32px", color: "#4A5568", fontSize: "12px" }}>
          Based on 14-hour minimum rest rule between flights · For reference only
        </div>
      </div>

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        * { box-sizing: border-box; }
        ::-webkit-scrollbar { width: 6px; height: 6px; }
        ::-webkit-scrollbar-track { background: #0A1628; }
        ::-webkit-scrollbar-thumb { background: #1E3A5F; border-radius: 3px; }
      `}</style>
    </div>
  );
}
