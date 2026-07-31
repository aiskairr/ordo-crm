import sharp from "sharp";

export type TelegramSaleCardData = {
  headerTitle?: string;
  statusBanner?: string;
  statusTone?: "danger" | "warning";
  documentLabel: string;
  documentName: string;
  amount: number;
  customerName: string;
  paymentLabel: string;
  employeeName: string;
  branchName: string;
  detailLabel?: string;
  footerLabel?: string;
};

function escapeXml(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function money(value: number) {
  return `${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(value)} сом`;
}

function wrapText(value: string, maxLength = 20, maxLines = 2) {
  const words = String(value || "-").trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (next.length <= maxLength || !line) {
      line = next;
      continue;
    }
    lines.push(line);
    line = word;
    if (lines.length === maxLines - 1) break;
  }
  if (line && lines.length < maxLines) lines.push(line);
  const consumed = lines.join(" ").length;
  if (consumed < String(value).trim().length && lines.length) {
    lines[lines.length - 1] = `${lines[lines.length - 1].slice(0, Math.max(1, maxLength - 1))}…`;
  }
  return lines.length ? lines : ["-"];
}

function detailCard(x: number, y: number, width: number, label: string, value: string) {
  const lines = wrapText(value);
  return `
    <rect x="${x}" y="${y}" width="${width}" height="154" rx="28" fill="#ffffff" stroke="#e4e9f2" stroke-width="2"/>
    <text x="${x + 28}" y="${y + 42}" class="label">${escapeXml(label)}</text>
    ${lines.map((line, index) => `<text x="${x + 28}" y="${y + 91 + index * 39}" class="value">${escapeXml(line)}</text>`).join("")}
  `;
}

export async function renderTelegramSaleCard(data: TelegramSaleCardData) {
  const amount = money(data.amount);
  const hasBanner = Boolean(data.statusBanner);
  const isWarning = data.statusTone === "warning";
  const bannerColor = isWarning ? "#d97706" : "#dc2626";
  const bannerCardColor = isWarning ? "#92400e" : "#7f1d1d";
  const bannerFooterColor = isWarning ? "#fef3c7" : "#fee2e2";
  const bannerTextColor = isWarning ? "#92400e" : "#b91c1c";
  const firstRowY = hasBanner ? 250 : 210;
  const secondRowY = hasBanner ? 438 : 398;
  const thirdRowY = hasBanner ? 610 : 570;
  const footerY = hasBanner ? 800 : 770;
  const svg = `
    <svg width="1000" height="1000" viewBox="0 0 1000 1000" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="page" x1="0" y1="0" x2="1000" y2="1000" gradientUnits="userSpaceOnUse">
          <stop stop-color="#dce6fa"/>
          <stop offset="1" stop-color="#edf3ff"/>
        </linearGradient>
        <linearGradient id="primary" x1="90" y1="230" x2="488" y2="400" gradientUnits="userSpaceOnUse">
          <stop stop-color="#071530"/>
          <stop offset="1" stop-color="#2868ee"/>
        </linearGradient>
        <filter id="shadow" x="0" y="0" width="1000" height="1000" filterUnits="userSpaceOnUse">
          <feDropShadow dx="0" dy="24" stdDeviation="24" flood-color="#14264c" flood-opacity="0.18"/>
        </filter>
        <style>
          text { font-family: Arial, "DejaVu Sans", sans-serif; }
          .label { fill: #6f7b91; font-size: 22px; font-weight: 700; letter-spacing: 1px; }
          .value { fill: #172033; font-size: 34px; font-weight: 700; }
        </style>
      </defs>
      <rect width="1000" height="1000" fill="url(#page)"/>
      <rect x="54" y="54" width="892" height="892" rx="42" fill="#f9fbff" stroke="#d5dcea" stroke-width="2" filter="url(#shadow)"/>

      ${hasBanner ? `
        <rect x="90" y="78" width="820" height="112" rx="28" fill="${bannerColor}"/>
        <text x="500" y="150" fill="#ffffff" font-size="58" font-weight="700" letter-spacing="3" text-anchor="middle">${escapeXml(data.statusBanner)}</text>
        <text x="92" y="226" fill="#657087" font-size="28" font-weight="700">${escapeXml(data.documentLabel)} №${escapeXml(data.documentName)} · ${escapeXml(data.headerTitle || "Выполнен")}</text>
      ` : `
        <text x="92" y="126" fill="#172033" font-size="46" font-weight="700">${escapeXml(data.headerTitle || "Документ создан")}</text>
        <text x="92" y="166" fill="#657087" font-size="28" font-weight="700">${escapeXml(data.documentLabel)} №${escapeXml(data.documentName)}</text>
      `}

      <rect x="90" y="${firstRowY}" width="398" height="170" rx="30" fill="${hasBanner ? bannerCardColor : "url(#primary)"}"/>
      <text x="120" y="${firstRowY + 50}" fill="#ffffff" font-size="22" font-weight="700" letter-spacing="1">${escapeXml(data.documentLabel.toUpperCase())}</text>
      <text x="120" y="${firstRowY + 124}" fill="#ffffff" font-size="50" font-weight="700">№${escapeXml(data.documentName)}</text>
      ${detailCard(506, firstRowY, 404, "СУММА", amount)}

      ${detailCard(90, secondRowY, 398, "КЛИЕНТ", data.customerName)}
      ${detailCard(506, secondRowY, 404, data.detailLabel || "ОПЛАТА", data.paymentLabel)}
      ${detailCard(90, thirdRowY, 398, "СОТРУДНИК", data.employeeName)}
      ${detailCard(506, thirdRowY, 404, "ФИЛИАЛ", data.branchName)}

      <rect x="90" y="${footerY}" width="820" height="80" rx="24" fill="${hasBanner ? bannerFooterColor : "#eaf0ff"}"/>
      <text x="500" y="${footerY + 50}" fill="${hasBanner ? bannerTextColor : "#315aa9"}" font-size="25" font-weight="700" text-anchor="middle">${escapeXml(data.footerLabel || "Наличная продажа без фото чека")}</text>
      <text x="500" y="930" fill="#8290aa" font-size="20" font-weight="700" text-anchor="middle">ORDO CRM</text>
    </svg>
  `;
  return sharp(Buffer.from(svg)).png().toBuffer();
}
