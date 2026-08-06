export const PRODUCT_CATALOG_MAX_PRODUCTS = 20;

export type CatalogProduct = {
  href: string;
  name: string;
  code: string;
  article: string;
  price: number;
  stock: number;
};

export type ProductCatalogPayload = {
  title: string;
  subtitle: string;
  showPrices: boolean;
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
