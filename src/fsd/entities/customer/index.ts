export type Customer = {
  id: number;
  href?: string;
  name: string;
  customerType?: "individual" | "entrepreneur" | "legal";
  phone?: string;
  actualAddress?: string;
};
