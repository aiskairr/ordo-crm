import "server-only";

export type ProductCatalogProduct = {
  name: string;
  code: string;
  article: string;
  folderName: string;
  description: string;
  price: number;
  priceLabel: string;
  priceCurrency: string;
  priceAvailable: boolean;
  characteristics: Array<{ name: string; value: string }>;
  imageDataUrls: string[];
};

export type ProductCatalogDocument = {
  title: string;
  subtitle: string;
  showPrices: boolean;
  createdAt: Date;
  companyLogoDataUrl: string;
  partnerLogoDataUrl: string;
  products: ProductCatalogProduct[];
};

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatMoney(value: number) {
  return new Intl.NumberFormat("ru-RU", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(Number.isFinite(value) ? value : 0);
}

function formatDate(value: Date) {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  }).format(value);
}

function formatCurrency(value: string) {
  const currency = value.trim().toUpperCase();
  if (currency === "KGS" || currency === "KGZ" || currency.includes("СОМ")) return "сом";
  if (currency === "USD" || currency.includes("ДОЛЛАР")) return "USD";
  return value.trim() || "сом";
}

function renderLogos(document: ProductCatalogDocument, compact = false) {
  return `<div class="brand-lockup${compact ? " brand-lockup--compact" : ""}">
    <img class="brand-logo brand-logo--company" src="${document.companyLogoDataUrl}" alt="Белек Техника">
    <span class="brand-divider" aria-hidden="true"></span>
    <img class="brand-logo brand-logo--partner" src="${document.partnerLogoDataUrl}" alt="GiftON">
  </div>`;
}

function renderGallery(product: ProductCatalogProduct) {
  if (!product.imageDataUrls.length) {
    return `<div class="gallery-empty">
      <span>Фото пока не добавлено</span>
      <small>Карточка товара в МойСклад не содержит изображений</small>
    </div>`;
  }

  const imageCount = Math.min(product.imageDataUrls.length, 8);
  return `<div class="gallery gallery--count-${imageCount} ${product.imageDataUrls.length === 1 ? "gallery--single" : ""}">
    ${product.imageDataUrls.map((imageDataUrl, index) => `
      <figure class="photo-card ${index === 0 ? "photo-card--hero" : ""}">
        <img src="${imageDataUrl}" alt="${escapeHtml(product.name)} — фото ${index + 1}">
        <figcaption>${String(index + 1).padStart(2, "0")}</figcaption>
      </figure>
    `).join("")}
  </div>`;
}

function renderCharacteristics(product: ProductCatalogProduct) {
  if (!product.characteristics.length) {
    return `<section class="details-block details-empty">
      <h3>Характеристики</h3>
      <p>Характеристики товара пока не заполнены в МойСклад.</p>
    </section>`;
  }
  return `<section class="details-block">
    <h3>Характеристики</h3>
    <div class="spec-grid">
      ${product.characteristics.map((item) => `
        <div class="spec-row">
          <span>${escapeHtml(item.name)}</span>
          <strong>${escapeHtml(item.value)}</strong>
        </div>
      `).join("")}
    </div>
  </section>`;
}

function renderProduct(document: ProductCatalogDocument, product: ProductCatalogProduct, index: number) {
  const meta = [
    product.folderName ? `<span>${escapeHtml(product.folderName)}</span>` : "",
    product.code ? `<span>Код ${escapeHtml(product.code)}</span>` : "",
    product.article ? `<span>Артикул ${escapeHtml(product.article)}</span>` : "",
  ].filter(Boolean).join("");

  return `<article class="product-page">
    <header class="product-header">
      ${renderLogos(document, true)}
      <div class="product-number">${String(index + 1).padStart(2, "0")} / ${String(document.products.length).padStart(2, "0")}</div>
    </header>

    <section class="product-layout">
      <div class="product-media-column">
        ${renderGallery(product)}
      </div>
      <div class="product-info-column">
        <section class="product-intro">
          <div>
            <div class="eyebrow">Каталог техники</div>
            <h2>${escapeHtml(product.name)}</h2>
            ${meta ? `<div class="meta">${meta}</div>` : ""}
          </div>
          ${document.showPrices ? `<div class="price ${product.priceAvailable ? "" : "price--empty"}"><span>${escapeHtml(product.priceLabel || "Цена")}</span>${product.priceAvailable ? `<strong>${escapeHtml(formatMoney(product.price))}</strong><small>${escapeHtml(formatCurrency(product.priceCurrency))}</small>` : `<strong>Не задана</strong>`}</div>` : ""}
        </section>
        ${product.description ? `<section class="details-block description"><h3>О товаре</h3><p>${escapeHtml(product.description)}</p></section>` : ""}
        ${renderCharacteristics(product)}
      </div>
    </section>
  </article>`;
}

export function buildProductCatalogHtml(document: ProductCatalogDocument) {
  const productWord = document.products.length === 1 ? "товар" : document.products.length < 5 ? "товара" : "товаров";
  const photoCount = document.products.reduce((total, product) => total + product.imageDataUrls.length, 0);

  return `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(document.title)}</title>
  <style>
    @page { size: A4; margin: 0; }
    * { box-sizing: border-box; }
    :root {
      --red: #ff1515;
      --red-dark: #d70c0c;
      --ink: #181818;
      --muted: #6f6f6f;
      --line: #e9e9e9;
    }
    html, body { margin: 0; padding: 0; background: #f1f1f1; color: var(--ink); font-family: Arial, Helvetica, sans-serif; }
    body { font-size: 11px; line-height: 1.42; }
    .print-tools { position: fixed; z-index: 20; right: 20px; top: 20px; display: flex; gap: 8px; padding: 8px; border-radius: 14px; background: rgba(255,255,255,.96); box-shadow: 0 12px 38px rgba(0,0,0,.18); }
    .print-tools button { min-height: 42px; border: 0; border-radius: 10px; background: var(--red); color: #fff; font: inherit; font-weight: 800; padding: 0 18px; cursor: pointer; }
    .catalog-page, .product-page { position: relative; width: 210mm; min-height: 297mm; margin: 0 auto 12px; overflow: hidden; background: #fff; }
    .catalog-page { display: flex; flex-direction: column; padding: 10mm 11mm; }
    .catalog-page::before { content: ""; position: absolute; width: 122mm; height: 122mm; right: -37mm; bottom: -43mm; border-radius: 50%; background: var(--red); }
    .catalog-page::after { content: ""; position: absolute; width: 58mm; height: 58mm; left: -30mm; top: 92mm; border-radius: 50%; border: 15mm solid #fff0f0; }
    .brand-lockup { position: relative; z-index: 2; display: flex; align-items: center; gap: 6mm; min-height: 22mm; }
    .brand-logo { display: block; flex: 0 0 auto; object-fit: contain; }
    .brand-logo--company { width: 66mm; height: 21mm; }
    .brand-logo--partner { width: 48mm; height: 18mm; }
    .brand-divider { width: 1px; height: 16mm; background: #dedede; }
    .cover-content { position: relative; z-index: 2; display: grid; align-content: center; flex: 1; padding: 7mm 0 10mm; }
    .cover-label { width: max-content; margin-bottom: 4mm; border-radius: 999px; background: #fff0f0; color: var(--red-dark); font-weight: 900; letter-spacing: .14em; padding: 2.5mm 4mm; text-transform: uppercase; }
    .cover-content h1 { max-width: 175mm; margin: 0; font-size: 18mm; line-height: .95; letter-spacing: -.045em; }
    .cover-content h1 em { display: block; color: var(--red); font-style: normal; }
    .cover-content p { max-width: 145mm; margin: 5mm 0 0; color: #515151; font-size: 4.2mm; line-height: 1.35; }
    .cover-summary { position: relative; z-index: 2; display: grid; grid-template-columns: repeat(3, 1fr); gap: 4mm; width: 137mm; }
    .cover-summary div { min-height: 21mm; border: 1px solid #ededed; border-radius: 4mm; background: #fff; padding: 4mm; box-shadow: 0 4mm 9mm rgba(34,34,34,.07); }
    .cover-summary span { display: block; color: #858585; font-size: 2.7mm; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; }
    .cover-summary strong { display: block; margin-top: 2mm; font-size: 6mm; line-height: 1; }
    .product-page { page-break-before: always; padding: 8mm 10mm 10mm; overflow: visible; }
    .product-header { display: flex; align-items: center; justify-content: space-between; min-height: 15mm; border-bottom: 1px solid var(--line); padding-bottom: 2.5mm; }
    .brand-lockup--compact { gap: 3mm; min-height: 10mm; }
    .brand-lockup--compact .brand-logo--company { width: 36mm; height: 10mm; }
    .brand-lockup--compact .brand-logo--partner { width: 25mm; height: 9mm; }
    .brand-lockup--compact .brand-divider { height: 8mm; }
    .product-number { border-radius: 999px; background: var(--red); color: #fff; font-size: 3.5mm; font-weight: 900; padding: 2.5mm 4mm; }
    .product-layout { display: grid; grid-template-columns: minmax(0, 108mm) minmax(0, 1fr); min-height: 252mm; align-items: stretch; gap: 6mm; padding-top: 5mm; }
    .product-media-column, .product-info-column { min-width: 0; min-height: 252mm; border-radius: 5mm; }
    .product-media-column { display: grid; border: 1px solid #ededed; background: #fafafa; padding: 3mm; }
    .product-info-column { display: grid; align-content: start; gap: 4mm; border: 1px solid #ededed; border-top: 3mm solid var(--red); background: #fff; padding: 6mm 5mm; }
    .product-intro { display: grid; align-items: start; gap: 5mm; padding: 0 0 2mm; break-inside: avoid; page-break-inside: avoid; }
    .product-intro > div:first-child { min-width: 0; }
    .eyebrow { color: var(--red); font-size: 3mm; font-weight: 900; letter-spacing: .12em; text-transform: uppercase; }
    .product-intro h2 { max-width: 100%; margin: 1.5mm 0 0; font-size: 7.2mm; line-height: 1.05; letter-spacing: -.025em; overflow-wrap: anywhere; }
    .meta { display: flex; flex-wrap: wrap; gap: 2mm; margin-top: 4mm; }
    .meta span { border-radius: 999px; background: #f5f5f5; color: #5b5b5b; font-weight: 700; padding: 2mm 3mm; }
    .price { width: 100%; border-radius: 4mm; background: var(--red); color: #fff; padding: 4mm; }
    .price span { display: block; font-size: 2.8mm; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; }
    .price strong { display: inline-block; margin-top: 2mm; font-size: 8mm; line-height: 1; }
    .price small { margin-left: 1mm; font-size: 3.5mm; font-weight: 800; }
    .gallery { display: grid; width: 100%; height: 100%; grid-template-columns: 1fr 1fr; grid-auto-rows: minmax(0, 1fr); gap: 3mm; }
    .gallery--single { grid-template-columns: 1fr; align-content: center; padding: 18mm 7mm; }
    .gallery--count-2 { grid-template-columns: 1fr; grid-template-rows: repeat(2, minmax(0, 1fr)); }
    .gallery--count-3 { grid-template-rows: repeat(2, minmax(0, 1fr)); }
    .gallery--count-3 .photo-card:first-child { grid-row: 1 / span 2; }
    .gallery--count-4 { grid-template-rows: repeat(2, minmax(0, 1fr)); }
    .gallery--count-5 { grid-template-rows: repeat(3, minmax(0, 1fr)); }
    .gallery--count-5 .photo-card:first-child { grid-column: 1 / -1; }
    .gallery--count-6 { grid-template-rows: repeat(3, minmax(0, 1fr)); }
    .gallery--count-7 { grid-template-rows: repeat(4, minmax(0, 1fr)); }
    .gallery--count-7 .photo-card:first-child { grid-column: 1 / -1; }
    .gallery--count-8 { grid-template-rows: repeat(4, minmax(0, 1fr)); }
    .photo-card, .photo-card--hero { position: relative; display: grid; min-width: 0; min-height: 0; place-items: center; margin: 0; overflow: hidden; border: 1px solid #ededed; border-radius: 4mm; background: #fff; break-inside: avoid; page-break-inside: avoid; }
    .photo-card img, .photo-card--hero img { width: 100%; height: 100%; min-height: 0; object-fit: contain; background: #fff; }
    .photo-card figcaption { position: absolute; right: 2mm; bottom: 2mm; display: grid; place-items: center; width: 7mm; height: 7mm; border-radius: 50%; background: var(--red); color: #fff; font-size: 2.5mm; font-weight: 900; }
    .gallery-empty { display: grid; place-items: center; min-height: 65mm; border: 1px dashed #d5d5d5; border-radius: 4mm; background: #fafafa; color: #6b6b6b; text-align: center; }
    .gallery-empty span { font-size: 4.5mm; font-weight: 900; }
    .gallery-empty small { display: block; max-width: 90mm; margin-top: 2mm; }
    .details-block { margin-top: 0; border-top: 2px solid var(--red); padding-top: 3mm; break-inside: avoid; page-break-inside: avoid; }
    .details-block h3 { margin: 0 0 2.5mm; font-size: 4.5mm; }
    .details-empty { border: 1px dashed #d6d6d6; border-top: 2px solid var(--red); border-radius: 0 0 3mm 3mm; background: #fafafa; padding: 3mm 4mm; }
    .details-empty p { margin: 0; color: #777; font-style: italic; }
    .description p { margin: 0; color: #4f4f4f; white-space: pre-wrap; }
    .spec-grid { display: grid; grid-template-columns: 1fr; }
    .spec-row { display: flex; justify-content: space-between; gap: 4mm; border-bottom: 1px solid var(--line); padding: 2.5mm 0; }
    .spec-row span { color: var(--muted); }
    .spec-row strong { max-width: 58%; text-align: right; }
    @media print {
      html, body { background: #fff; }
      .print-tools { display: none !important; }
      .catalog-page, .product-page { margin: 0; box-shadow: none; }
    }
    @media screen and (max-width: 900px) {
      .catalog-page, .product-page { transform-origin: top left; }
    }
  </style>
</head>
<body>
  <div class="print-tools"><button type="button" onclick="window.print()">Печать / сохранить PDF</button></div>
  <section class="catalog-page">
    ${renderLogos(document)}
    <div class="cover-content">
      <div class="cover-label">Белек Техника × GiftON</div>
      <h1>${escapeHtml(document.title)}<em>${escapeHtml(document.createdAt.getFullYear())}</em></h1>
      ${document.subtitle ? `<p>${escapeHtml(document.subtitle)}</p>` : ""}
    </div>
    <div class="cover-summary">
      <div><span>Подборка</span><strong>${document.products.length} ${productWord}</strong></div>
      <div><span>Фотографий</span><strong>${photoCount}</strong></div>
      <div><span>Сформирован</span><strong>${escapeHtml(formatDate(document.createdAt))}</strong></div>
    </div>
  </section>
  ${document.products.map((product, index) => renderProduct(document, product, index)).join("")}
</body>
</html>`;
}
