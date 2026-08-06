export const PRODUCT_CATALOG_MAX_PRODUCTS = 20;

export type CatalogPrice = {
  name: string;
  value: number;
  currency: string;
};

export type CatalogProduct = {
  href: string;
  name: string;
  code: string;
  article: string;
  price: number;
  stock: number;
  prices: CatalogPrice[];
};

export type ProductCatalogPayload = {
  title: string;
  subtitle: string;
  showPrices: boolean;
  priceTypeName: string;
  items: CatalogProduct[];
};

export type ProductCatalogFile = {
  blob: Blob;
  fileName: string;
  contentType: string;
};

export function moveCatalogProduct(products: CatalogProduct[], index: number, direction: -1 | 1) {
  const targetIndex = index + direction;
  if (targetIndex < 0 || targetIndex >= products.length) return products;
  const next = [...products];
  [next[index], next[targetIndex]] = [next[targetIndex], next[index]];
  return next;
}
