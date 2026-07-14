"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Camera, CreditCard, ImagePlus, PackagePlus, ReceiptText, Search, Truck, Trash2, UserRound, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Customer } from "@/src/fsd/entities/customer";
import type { Product } from "@/src/fsd/entities/product";
import { StatusPanel } from "@/src/fsd/shared/ui/status";
import { useToast } from "@/src/fsd/shared/ui/toast";
import { getErrorText } from "@/src/fsd/shared/lib/errors";
import type { CurrentSalesUser, PaymentTypeOption, RetailStore, SalesConfig, SelectOption } from "@/src/fsd/pages/sales/api/sales-api";
import { calculateSale, createOrder, getCustomers, getProducts } from "@/src/fsd/pages/sales/api/sales-api";
import styles from "./sale-composer.module.css";

type BranchKey = "ayu" | "besh";
type PaymentScenario = "cash" | "bank" | "mixed" | "debt";
type CustomerMode = "retail" | "new" | "existing";

type OrderItem = {
  localId: string;
  productName: string;
  assortmentHref: string;
  assortmentType: string;
  productPrice: number;
  priceManual: boolean;
  productCost: number;
  productCode: string;
  deliverySelected: boolean;
  isGift: boolean;
  quantity: number;
  regularPrice?: number;
};

type CreatedOrderResult = {
  document?: {
    id?: string;
    name?: string;
    type?: string;
    webUrl?: string;
  };
  calculation?: {
    finalTotal?: number;
    paymentLabel?: string;
    items?: Array<{
      productName?: string;
      name?: string;
      quantity?: number;
      isGift?: boolean;
    }>;
  };
};

type SuccessModalState = {
  documentName: string;
  documentType: string;
  documentUrl: string;
  finalTotal: number;
  paymentLabel: string;
  customerName: string;
  employeeName: string;
  branchName: string;
  items: Array<{ name: string; quantity: number; isGift: boolean }>;
};

type ConfirmModalState = {
  title: string;
  subtitle: string;
  total: number;
  customerName: string;
  paymentLabel: string;
  documentLabel: string;
};

type SalesDraft = {
  branchKey: BranchKey;
  paymentScenario: PaymentScenario;
  cashPrepayment: string;
  prepaymentMethodName: string;
  transferPrepayment: string;
  paymentTypeHref: string;
  secondPaymentTypeHref: string;
  secondBankAmount: string;
  employeeHref: string;
  retailStoreHref: string;
  customerMode: CustomerMode;
  customerHref: string;
  customerName: string;
  customerPhone: string;
  customerAddress: string;
  deliveryEnabled: boolean;
  deliveryDate: string;
  deliveryTime: string;
  deliveryAddress: string;
  deliveryNotes: string;
  loyaltyRedemption: string;
  items: OrderItem[];
};

const salesDraftKey = "ordo-crm:sales-draft-v2";
const debtDraftKey = "ordo-crm:debt-sale-draft-v1";
const branches: Record<BranchKey, string> = {
  ayu: "Аю-Гранд",
  besh: "Беш-Сары",
};

const emptyDraft: SalesDraft = {
  branchKey: "ayu",
  paymentScenario: "cash",
  cashPrepayment: "0",
  prepaymentMethodName: "Наличными",
  transferPrepayment: "0",
  paymentTypeHref: "",
  secondPaymentTypeHref: "",
  secondBankAmount: "0",
  employeeHref: "",
  retailStoreHref: "",
  customerMode: "retail",
  customerHref: "",
  customerName: "",
  customerPhone: "",
  customerAddress: "",
  deliveryEnabled: false,
  deliveryDate: "",
  deliveryTime: "",
  deliveryAddress: "",
  deliveryNotes: "",
  loyaltyRedemption: "0",
  items: [],
};

function loadDraft(key = salesDraftKey, mode: "sales" | "debt" = "sales"): SalesDraft {
  if (typeof window === "undefined") return emptyDraft;
  try {
    const saved = window.localStorage.getItem(key);
    const draft = saved ? { ...emptyDraft, ...JSON.parse(saved) } : emptyDraft;
    if (mode === "debt") {
      return { ...draft, paymentScenario: "debt", customerMode: draft.customerMode === "retail" ? "new" : draft.customerMode };
    }
    return draft;
  } catch {
    return mode === "debt" ? { ...emptyDraft, paymentScenario: "debt", customerMode: "new" } : emptyDraft;
  }
}

function money(value: number) {
  return `${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(Number(value) || 0)} сом`;
}

function printReceipt(state: SuccessModalState) {
  const popup = window.open("", "_blank", "width=420,height=760");
  if (!popup) throw new Error("Браузер заблокировал окно печати.");

  const items = state.items
    .map((item) => `<tr><td>${item.name}${item.isGift ? " (подарок)" : ""}</td><td style="text-align:right;">${item.quantity}</td></tr>`)
    .join("");

  popup.document.write(`
    <!doctype html>
    <html lang="ru">
      <head>
        <meta charset="utf-8" />
        <title>Чек ${state.documentName}</title>
        <style>
          body { font-family: Arial, sans-serif; padding: 20px; color: #111827; }
          h1 { margin: 0 0 8px; font-size: 22px; }
          .meta { margin: 0 0 16px; font-size: 13px; color: #4b5563; }
          table { width: 100%; border-collapse: collapse; margin: 14px 0; }
          td { padding: 6px 0; border-bottom: 1px dashed #d1d5db; vertical-align: top; font-size: 14px; }
          .total { margin-top: 16px; font-size: 20px; font-weight: 700; }
          .label { font-size: 12px; color: #6b7280; text-transform: uppercase; letter-spacing: .08em; }
        </style>
      </head>
      <body>
        <div class="label">${state.documentType === "retaildemand" ? "Продажа" : "Отгрузка"}</div>
        <h1>${state.documentName || "Документ"}</h1>
        <div class="meta">
          <div>Дата: ${new Date().toLocaleString("ru-RU")}</div>
          <div>Филиал: ${state.branchName || "-"}</div>
          <div>Сотрудник: ${state.employeeName || "-"}</div>
          <div>Клиент: ${state.customerName || "Розничный покупатель"}</div>
          <div>Оплата: ${state.paymentLabel || "-"}</div>
        </div>
        <table>
          <tbody>${items}</tbody>
        </table>
        <div class="total">Итого: ${money(state.finalTotal)}</div>
        <script>
          window.onload = () => {
            window.print();
          };
        </script>
      </body>
    </html>
  `);
  popup.document.close();
}

function normalizeCreatedOrderResult(
  payload: unknown,
  draft: SalesDraft,
  currentUser: CurrentSalesUser | null,
): SuccessModalState {
  const record = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  const document = record.document && typeof record.document === "object" ? (record.document as Record<string, unknown>) : {};
  const calculation = record.calculation && typeof record.calculation === "object" ? (record.calculation as Record<string, unknown>) : {};
  const rawItems = Array.isArray(calculation.items) ? calculation.items : [];

  return {
    documentName: typeof document.name === "string" ? document.name : "Без номера",
    documentType: typeof document.type === "string" ? document.type : "demand",
    documentUrl: typeof document.webUrl === "string" ? document.webUrl : "",
    finalTotal: typeof calculation.finalTotal === "number" ? calculation.finalTotal : 0,
    paymentLabel: typeof calculation.paymentLabel === "string" ? calculation.paymentLabel : "",
    customerName: draft.customerName || "Розничный покупатель",
    employeeName: currentUser?.name || "",
    branchName: branches[draft.branchKey],
    items: rawItems.map((item) => {
      const row = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
      return {
        name: typeof row.productName === "string" ? row.productName : typeof row.name === "string" ? row.name : "Товар",
        quantity: typeof row.quantity === "number" ? row.quantity : 1,
        isGift: row.isGift === true,
      };
    }),
  };
}

function isCashPaymentType(paymentType: PaymentTypeOption) {
  const name = paymentType.name.toLowerCase();
  return name.includes("налич") || name.includes("cash") || name.includes("карта");
}

function isQrPaymentType(paymentType: PaymentTypeOption) {
  return paymentType.name.toLowerCase().includes("qr");
}

function isDebtPaymentType(paymentType: PaymentTypeOption) {
  return paymentType.name.toLowerCase().includes("долг");
}

function isCashOnlyPaymentType(paymentType: PaymentTypeOption) {
  const name = paymentType.name.toLowerCase();
  return name.includes("налич") || name.includes("cash") || name.includes("карта");
}

function isBankScenarioPaymentType(paymentType: PaymentTypeOption) {
  return !isDebtPaymentType(paymentType) && !isCashOnlyPaymentType(paymentType);
}

function isBankPaymentType(paymentType: PaymentTypeOption) {
  return !isCashPaymentType(paymentType) && !isDebtPaymentType(paymentType) && !isQrPaymentType(paymentType);
}

function findCashPaymentType(paymentTypes: PaymentTypeOption[]) {
  return paymentTypes.find(isCashPaymentType) ?? paymentTypes[0];
}

function findDebtPaymentType(paymentTypes: PaymentTypeOption[]) {
  return paymentTypes.find(isDebtPaymentType) ?? paymentTypes[0];
}

function normalizeLookup(value: string) {
  return value
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^a-zа-я0-9]+/giu, " ")
    .trim();
}

function employeeMatchesBranches(employee: SelectOption, branchIds: Set<string>) {
  if (!branchIds.size) return true;
  const employeeBranches = Array.isArray(employee.branches) ? employee.branches.filter(Boolean) : [];
  if (employeeBranches.length) {
    return employeeBranches.some((branch) => branchIds.has(branch));
  }
  return !employee.branchKey || branchIds.has(employee.branchKey);
}

function findCurrentEmployee(employees: SelectOption[], currentUser: CurrentSalesUser | null) {
  if (!currentUser) return null;
  const currentName = normalizeLookup(currentUser.name);
  const currentLogin = normalizeLookup(currentUser.login ?? "");
  const branches = new Set(currentUser.branches);

  return (
    employees.find((employee) => employee.id === currentUser.id || employee.href === currentUser.id) ??
    employees.find((employee) => {
      const employeeName = normalizeLookup(employee.name);
      const branchMatches = employeeMatchesBranches(employee, branches);
      return branchMatches && Boolean(currentName) && employeeName === currentName;
    }) ??
    employees.find((employee) => {
      const employeeName = normalizeLookup(employee.name);
      const branchMatches = employeeMatchesBranches(employee, branches);
      return branchMatches && Boolean(currentName) && (employeeName.includes(currentName) || currentName.includes(employeeName));
    }) ??
    employees.find((employee) => {
      const employeeName = normalizeLookup(employee.name);
      return Boolean(currentLogin) && employeeName.includes(currentLogin);
    }) ??
    null
  );
}

function visiblePaymentTypes(paymentTypes: PaymentTypeOption[], scenario: PaymentScenario) {
  if (scenario === "cash") return paymentTypes.filter(isCashPaymentType);
  if (scenario === "debt") return paymentTypes.filter(isDebtPaymentType);
  if (scenario === "mixed") return paymentTypes.filter(isBankPaymentType);
  return paymentTypes.filter(isBankScenarioPaymentType);
}

async function readReceiptPhoto(file: File) {
  const image = await createImageBitmap(file);
  const maxSide = 1600;
  const scale = Math.min(1, maxSide / Math.max(image.width, image.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.width * scale));
  canvas.height = Math.max(1, Math.round(image.height * scale));
  canvas.getContext("2d")?.drawImage(image, 0, 0, canvas.width, canvas.height);
  image.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.78));
  if (!blob) throw new Error("Не удалось обработать фотографию чека.");

  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Не удалось прочитать фотографию чека."));
    reader.readAsDataURL(blob);
  });

  return {
    name: `receipt-${Date.now()}.jpg`,
    mimeType: "image/jpeg",
    data: dataUrl.split(",")[1] || "",
  };
}

export function SaleComposer({
  employees,
  currentUser,
  retailStores,
  paymentTypes,
  mode = "sales",
}: {
  config: SalesConfig;
  employees: SelectOption[];
  currentUser: CurrentSalesUser | null;
  retailStores: RetailStore[];
  paymentTypes: PaymentTypeOption[];
  products: Product[];
  customers: Customer[];
  mode?: "sales" | "debt";
}) {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const draftStorageKey = mode === "debt" ? debtDraftKey : salesDraftKey;
  const [draft, setDraft] = useState<SalesDraft>(() => loadDraft(draftStorageKey, mode));
  const [productQuery, setProductQuery] = useState("");
  const [productResults, setProductResults] = useState<Product[]>([]);
  const [customerQuery, setCustomerQuery] = useState("");
  const [customerResults, setCustomerResults] = useState<Customer[]>([]);
  const [calculation, setCalculation] = useState<Record<string, unknown> | null>(null);
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraError, setCameraError] = useState("");
  const [successModal, setSuccessModal] = useState<SuccessModalState | null>(null);
  const [confirmModal, setConfirmModal] = useState<ConfirmModalState | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);
  const cameraInputRef = useRef<HTMLInputElement | null>(null);
  const galleryInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    window.localStorage.setItem(draftStorageKey, JSON.stringify(draft));
  }, [draft, draftStorageKey]);

  const stopCamera = useCallback(() => {
    cameraStreamRef.current?.getTracks().forEach((track) => track.stop());
    cameraStreamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setCameraOpen(false);
  }, []);

  useEffect(() => {
    return () => stopCamera();
  }, [stopCamera]);

  const openWebCamera = async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError("Браузер не дал доступ к камере. Используйте выбор файла.");
      return;
    }

    try {
      setCameraError("");
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 960 } },
        audio: false,
      });
      cameraStreamRef.current = stream;
      setCameraOpen(true);
      window.setTimeout(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play().catch(() => undefined);
        }
      }, 0);
    } catch {
      setCameraError("Не удалось открыть камеру. Проверьте разрешение браузера.");
    }
  };

  const captureReceiptPhoto = async () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth || !video.videoHeight) {
      setCameraError("Камера еще не готова.");
      return;
    }

    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d")?.drawImage(video, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.86));
    if (!blob) {
      setCameraError("Не удалось сохранить снимок.");
      return;
    }

    setReceiptFile(new File([blob], `receipt-${Date.now()}.jpg`, { type: "image/jpeg" }));
    stopCamera();
  };

  const selectReceiptFile = (file?: File) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      showToast({ tone: "error", title: "Нужна фотография", description: "Выберите изображение чека." });
      return;
    }
    setReceiptFile(file);
  };

  const branchName = branches[draft.branchKey];
  const branchStores = retailStores.filter((store) => !branchName || store.name.includes(branchName) || store.name === branchName);
  const selectedStore = retailStores.find((store) => store.id === draft.retailStoreHref) ?? branchStores[0] ?? retailStores[0];
  const selectedEmployee = findCurrentEmployee(employees, currentUser);
  const visibleTypes = visiblePaymentTypes(paymentTypes, draft.paymentScenario);
  const selectedPaymentType = paymentTypes.find((paymentType) => paymentType.id === draft.paymentTypeHref) ?? visibleTypes[0];
  const secondPaymentType = paymentTypes.find((paymentType) => paymentType.id === draft.secondPaymentTypeHref);
  const selectedCustomer = customerResults.find((customer) => customer.href === draft.customerHref);

  const productSearchMutation = useMutation({
    mutationFn: (search: string) => getProducts(search, selectedStore?.storeHref ?? "", branchName),
    onSuccess: setProductResults,
  });

  const customerSearchMutation = useMutation({
    mutationFn: (search: string) => getCustomers(search, branchName),
    onSuccess: setCustomerResults,
  });

  useEffect(() => {
    const search = productQuery.trim();
    if (search.length < 2) return;

    const timer = window.setTimeout(() => {
      productSearchMutation.mutate(search);
    }, 350);

    return () => window.clearTimeout(timer);
    // productSearchMutation is intentionally omitted: TanStack mutation objects are not stable dependencies.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productQuery, draft.retailStoreHref, draft.branchKey]);

  useEffect(() => {
    const search = customerQuery.trim();
    if (draft.customerMode !== "existing" || search.length < 2) return;

    const timer = window.setTimeout(() => {
      customerSearchMutation.mutate(search);
    }, 350);

    return () => window.clearTimeout(timer);
    // customerSearchMutation is intentionally omitted: TanStack mutation objects are not stable dependencies.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerQuery, draft.customerMode, draft.branchKey]);

  const calculateMutation = useMutation({
    mutationFn: calculateSale,
    onSuccess: (data) => setCalculation(data && typeof data === "object" ? (data as Record<string, unknown>) : null),
  });

  const orderMutation = useMutation({
    mutationFn: createOrder,
    onSuccess: async (result) => {
      setSuccessModal(normalizeCreatedOrderResult(result as CreatedOrderResult, draft, currentUser));
      showToast({ tone: "success", title: "Документ создан", description: "Продажа сохранена в МойСклад." });
      setDraft(mode === "debt" ? { ...emptyDraft, paymentScenario: "debt", customerMode: "new" } : emptyDraft);
      setCalculation(null);
      setReceiptFile(null);
      window.localStorage.removeItem(draftStorageKey);
      await queryClient.invalidateQueries({ queryKey: ["products"] });
      await queryClient.invalidateQueries({ queryKey: ["customers"] });
    },
  });

  const updateDraft = <K extends keyof SalesDraft>(field: K, value: SalesDraft[K]) => {
    setDraft((current) => ({ ...current, [field]: value }));
  };

  const setScenario = (scenario: PaymentScenario) => {
    const nextType = scenario === "cash"
      ? findCashPaymentType(paymentTypes)
      : scenario === "debt"
        ? findDebtPaymentType(paymentTypes)
        : visiblePaymentTypes(paymentTypes, scenario)[0];
    setDraft((current) => ({
      ...current,
      paymentScenario: scenario,
      paymentTypeHref: nextType?.id ?? "",
      cashPrepayment: scenario === "cash" || scenario === "bank" ? "0" : current.cashPrepayment,
      prepaymentMethodName: scenario === "cash" ? "Наличными" : current.prepaymentMethodName,
      secondPaymentTypeHref: scenario === "mixed" ? current.secondPaymentTypeHref : "",
      secondBankAmount: scenario === "mixed" ? current.secondBankAmount : "0",
    }));
  };

  const addProduct = (product: Product) => {
    const href = product.href;
    if (!href) return;
    setDraft((current) => ({
      ...current,
      items: [
        ...current.items,
        {
          localId: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
          productName: product.name,
          assortmentHref: href,
          assortmentType: product.type || "product",
          productPrice: product.price,
          priceManual: false,
          productCost: product.cost || 0,
          productCode: product.code || "",
          deliverySelected: true,
          isGift: false,
          quantity: 1,
        },
      ],
    }));
    setProductQuery("");
    setProductResults([]);
  };

  const updateItem = <K extends keyof OrderItem>(localId: string, field: K, value: OrderItem[K]) => {
    setDraft((current) => ({
      ...current,
      items: current.items.map((item) => {
        if (item.localId !== localId) return item;
        if (field === "isGift") {
          const gift = Boolean(value);
          return {
            ...item,
            isGift: gift,
            regularPrice: gift ? item.productPrice || item.regularPrice || 0 : item.regularPrice,
            productPrice: gift ? 0 : item.regularPrice || item.productPrice,
          };
        }
        return { ...item, [field]: value };
      }),
    }));
  };

  const deliveryDateTime =
    draft.deliveryEnabled && draft.deliveryDate && draft.deliveryTime ? new Date(`${draft.deliveryDate}T${draft.deliveryTime}:00`).toISOString() : "";
  const payload = {
    items: draft.items,
    cashPrepayment: draft.cashPrepayment,
    prepaymentMethodName: draft.prepaymentMethodName,
    transferPrepayment: draft.transferPrepayment,
    paymentScenario: draft.paymentScenario,
    loyaltyRedemption: draft.loyaltyRedemption,
    paymentTypeName: selectedPaymentType?.name || "",
    paymentTypeHref: selectedPaymentType?.href || selectedPaymentType?.id || "",
    paymentTypeRate: selectedPaymentType?.rate ?? 0,
    paymentTypeComment: selectedPaymentType?.comment || "",
    secondPaymentTypeName: secondPaymentType?.name || "",
    secondPaymentTypeHref: secondPaymentType?.href || secondPaymentType?.id || "",
    secondPaymentTypeRate: secondPaymentType?.rate ?? 0,
    secondPaymentTypeComment: secondPaymentType?.comment || "",
    secondBankAmount: draft.secondBankAmount,
    employeeName: selectedEmployee?.name || "",
    employeeHref: selectedEmployee?.href || selectedEmployee?.id || "",
      retailStoreName: selectedStore?.name || "",
      branchName,
      retailStoreHref: selectedStore?.href || selectedStore?.id || "",
    storeHref: selectedStore?.storeHref || "",
    customerMode: draft.customerMode,
    customerHref: selectedCustomer?.href || draft.customerHref,
    customerName: draft.customerName.trim(),
    customerPhone: draft.customerPhone.trim(),
    customerAddress: (draft.customerAddress || draft.deliveryAddress).trim(),
    delivery: {
      enabled: draft.deliveryEnabled,
      scheduledAt: deliveryDateTime,
      address: draft.deliveryAddress.trim(),
      notes: draft.deliveryNotes.trim(),
      items: draft.deliveryEnabled
        ? draft.items.filter((item) => item.deliverySelected !== false).map((item) => ({ name: item.productName, code: item.productCode, quantity: item.quantity }))
        : [],
    },
  };

  const runCalculation = () => {
    if (!draft.items.length) {
      setCalculation(null);
      return;
    }
    calculateMutation.mutate(payload);
  };

  const validateBeforeSubmit = () => {
    if (!draft.items.length) throw new Error("Добавьте хотя бы один товар.");
    if (!selectedEmployee) throw new Error("Выберите сотрудника.");
    if (!selectedStore) throw new Error("Выберите точку продаж.");
    if (!selectedPaymentType) throw new Error("Выберите тип оплаты.");
    if (!receiptFile && mode !== "debt") throw new Error("Добавьте фотографию чека.");
    if (mode === "debt" && draft.customerMode === "retail") throw new Error("Для продажи в долг выберите нового или старого клиента.");
    if (draft.customerMode === "new" && (!draft.customerName.trim() || !draft.customerPhone.trim())) throw new Error("Введите имя и телефон клиента.");
    if (draft.customerMode === "existing" && !draft.customerHref) throw new Error("Выберите существующего клиента.");
    if (draft.deliveryEnabled && (!draft.deliveryDate || !draft.deliveryTime || !draft.deliveryAddress.trim())) throw new Error("Заполните дату, время и адрес доставки.");
  };

  const openConfirmModal = () => {
    validateBeforeSubmit();
    setConfirmModal({
      title: mode === "debt" ? "Подтвердите создание отгрузки" : "Подтвердите создание документа",
      subtitle:
        mode === "debt"
          ? "Документ будет создан в МойСклад с фиксацией долга клиента."
          : "CRM отправит документ в МойСклад, привяжет чек и выполнит связанные действия после сохранения.",
      total: Number(calculation?.finalTotal ?? baseTotal),
      customerName: draft.customerName.trim() || "Розничный покупатель",
      paymentLabel: String(calculation?.paymentLabel ?? selectedPaymentType?.name ?? draft.prepaymentMethodName ?? "-"),
      documentLabel: mode === "debt" ? "Отгрузка" : "Продажа",
    });
  };

  const submitOrder = async () => {
    validateBeforeSubmit();

    const finalPayload = {
      ...payload,
      receiptPhoto: receiptFile ? await readReceiptPhoto(receiptFile) : undefined,
      requestKey: crypto.randomUUID(),
    };
    orderMutation.mutate(finalPayload);
  };

  const baseTotal = draft.items.reduce((sum, item) => sum + item.productPrice * item.quantity, 0);
  const finalTotal = Number(calculation?.finalTotal ?? baseTotal);

  useEffect(() => {
    if (productSearchMutation.error) {
      showToast({ tone: "error", title: "Не удалось найти товары", description: getErrorText(productSearchMutation.error) });
    }
  }, [productSearchMutation.error, showToast]);

  useEffect(() => {
    if (customerSearchMutation.error) {
      showToast({ tone: "error", title: "Не удалось найти клиентов", description: getErrorText(customerSearchMutation.error) });
    }
  }, [customerSearchMutation.error, showToast]);

  useEffect(() => {
    if (calculateMutation.error) {
      showToast({ tone: "error", title: "Ошибка расчета", description: getErrorText(calculateMutation.error) });
    }
  }, [calculateMutation.error, showToast]);

  useEffect(() => {
    if (orderMutation.error) {
      showToast({ tone: "error", title: "Ошибка создания документа", description: getErrorText(orderMutation.error) });
    }
  }, [orderMutation.error, showToast]);

  return (
    <div className={styles.composer}>
      {!selectedEmployee ? (
        <StatusPanel
          tone="error"
          title="Сотрудник не привязан к МойСклад"
          description="Текущий аккаунт не найден в справочнике сотрудников МойСклад. Проверьте имя сотрудника или синхронизацию сотрудников."
        />
      ) : null}

      <section className={styles.panel}>
        <h2>Филиал и справочники</h2>
        <div className={styles.formGrid}>
          <label>
            Филиал
            <select value={draft.branchKey} onChange={(event) => updateDraft("branchKey", event.target.value as BranchKey)}>
              <option value="ayu">Аю-Гранд</option>
              <option value="besh">Беш-Сары</option>
            </select>
          </label>
          <label>
            Точка продаж
            <select value={selectedStore?.id ?? ""} onChange={(event) => updateDraft("retailStoreHref", event.target.value)}>
              {retailStores.map((store) => (
                <option key={store.id} value={store.id}>
                  {store.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Сотрудник
            <select value={selectedEmployee?.id ?? ""} disabled>
              {selectedEmployee ? (
                <option value={selectedEmployee.id}>{selectedEmployee.name}</option>
              ) : (
                <option value="">Не найден текущий сотрудник</option>
              )}
            </select>
          </label>
        </div>
      </section>

      <section className={styles.panel}>
        <h2>Товары</h2>
        <div className={styles.searchLine}>
          <Search size={18} />
          <input value={productQuery} onChange={(event) => setProductQuery(event.target.value)} placeholder="Поиск по названию, SKU или штрихкоду" />
          {productSearchMutation.isPending ? <span>Ищу...</span> : null}
        </div>
        {productQuery.trim().length >= 2 && productResults.length ? (
          <div className={styles.results}>
            {productResults.slice(0, 12).map((product) => (
              <button key={product.href ?? product.id} type="button" onClick={() => addProduct(product)}>
                <strong>{product.name}</strong>
                <span>{[product.code ? `Код: ${product.code}` : "", `Цена: ${money(product.price)}`, product.stock !== undefined ? `Остаток: ${product.stock}` : ""].filter(Boolean).join(" · ")}</span>
              </button>
            ))}
          </div>
        ) : null}

        {draft.items.length ? (
          <div className={styles.items}>
            {draft.items.map((item) => (
              <div key={item.localId} className={styles.itemRow}>
                <strong>{item.productName}</strong>
                <input type="number" min="1" value={item.quantity} onChange={(event) => updateItem(item.localId, "quantity", Number(event.target.value))} />
                <input type="number" min="0" value={item.productPrice} disabled={item.isGift} onChange={(event) => updateItem(item.localId, "productPrice", Number(event.target.value))} />
                <label className={styles.gift}>
                  <input type="checkbox" checked={item.isGift} onChange={(event) => updateItem(item.localId, "isGift", event.target.checked)} />
                  Подарок
                </label>
                {draft.deliveryEnabled ? (
                  <label className={styles.gift}>
                    <input
                      type="checkbox"
                      checked={item.deliverySelected !== false}
                      onChange={(event) => updateItem(item.localId, "deliverySelected", event.target.checked)}
                    />
                    Доставка
                  </label>
                ) : null}
                <button type="button" onClick={() => setDraft((current) => ({ ...current, items: current.items.filter((row) => row.localId !== item.localId) }))}>
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <div className={styles.emptyState}>
            <PackagePlus size={34} />
            <strong>Товары пока не добавлены</strong>
            <span>Начните с поиска по названию, SKU или штрихкоду. Добавленные позиции появятся здесь.</span>
          </div>
        )}
      </section>

      <section className={styles.panel}>
        <div className={styles.sectionHead}>
          <div className={styles.sectionIcon}>
            <CreditCard size={20} />
          </div>
          <div>
            <h2>Оплата</h2>
            <p>{mode === "debt" ? "Документ будет создан как отгрузка с долгом клиента." : "Выберите сценарий оплаты и банк для документа."}</p>
          </div>
        </div>
        {mode === "debt" ? (
          <div className={styles.modeNotice}>
            <strong>Режим долга</strong>
            <span>Чек необязателен. Документ уйдет в МойСклад как отгрузка, а задолженность останется за клиентом.</span>
          </div>
        ) : null}
        {mode === "debt" ? (
          <div className={`${styles.segmented} ${styles.paymentSegmented}`}>
            <button type="button" className={styles.segmentActive}>В долг</button>
          </div>
        ) : (
          <div className={`${styles.segmented} ${styles.paymentSegmented}`}>
            {[
              ["cash", "Наличные"],
              ["bank", "Банк"],
              ["mixed", "Смешанная"],
            ].map(([value, label]) => (
              <button key={value} type="button" className={draft.paymentScenario === value ? styles.segmentActive : ""} onClick={() => setScenario(value as PaymentScenario)}>
                {label}
              </button>
            ))}
          </div>
        )}
        <div className={styles.formGrid}>
          {draft.paymentScenario !== "cash" ? (
            <label>
              Тип оплаты
              <select value={selectedPaymentType?.id ?? ""} onChange={(event) => updateDraft("paymentTypeHref", event.target.value)}>
                {visibleTypes.map((paymentType) => (
                  <option key={paymentType.id} value={paymentType.id}>
                    {paymentType.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {draft.paymentScenario === "mixed" || draft.paymentScenario === "debt" ? (
            <>
              <label>
                {draft.paymentScenario === "debt" ? "Предоплата" : "Оплата сразу"}
                <input value={draft.cashPrepayment} onChange={(event) => updateDraft("cashPrepayment", event.target.value)} />
              </label>
              <label>
                Способ оплаты сразу
                <select value={draft.prepaymentMethodName} onChange={(event) => updateDraft("prepaymentMethodName", event.target.value)}>
                  <option value="Наличными">Наличными</option>
                  {paymentTypes.filter(isQrPaymentType).map((paymentType) => (
                    <option key={paymentType.id} value={paymentType.name}>
                      {paymentType.name}
                    </option>
                  ))}
                </select>
              </label>
              {draft.paymentScenario === "mixed" ? (
                <>
                  <label>
                    Банк №2
                    <select value={draft.secondPaymentTypeHref} onChange={(event) => updateDraft("secondPaymentTypeHref", event.target.value)}>
                      <option value="">Выберите второй банк</option>
                      {paymentTypes.filter(isBankPaymentType).map((paymentType) => (
                        <option key={paymentType.id} value={paymentType.id}>
                          {paymentType.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Сумма банк №2
                    <input value={draft.secondBankAmount} onChange={(event) => updateDraft("secondBankAmount", event.target.value)} />
                  </label>
                </>
              ) : null}
            </>
          ) : null}
        </div>
      </section>

      <section className={styles.panel}>
        <div className={styles.sectionHead}>
          <div className={styles.sectionIcon}>
            <UserRound size={20} />
          </div>
          <div>
            <h2>Клиент и доставка</h2>
            <p>Клиентская карточка и параметры доставки по заказу.</p>
          </div>
        </div>
        <div className={`${styles.segmented} ${styles.customerSegmented}`}>
          {(mode === "debt" ? [
            ["new", "Новый"],
            ["existing", "Старый клиент"],
          ] : [
            ["retail", "Розница"],
            ["new", "Новый"],
            ["existing", "Старый клиент"],
          ]).map(([value, label]) => (
            <button key={value} type="button" className={draft.customerMode === value ? styles.segmentActive : ""} onClick={() => updateDraft("customerMode", value as CustomerMode)}>
              {label}
            </button>
          ))}
        </div>
        {draft.customerMode === "existing" ? (
          <>
            <div className={styles.searchLine}>
              <Search size={18} />
              <input value={customerQuery} onChange={(event) => setCustomerQuery(event.target.value)} placeholder="Имя или телефон клиента" />
              {customerSearchMutation.isPending ? <span>Ищу...</span> : null}
            </div>
            {customerQuery.trim().length >= 2 && customerResults.length ? (
              <div className={styles.results}>
                {customerResults.slice(0, 12).map((customer) => (
                  <button
                    key={customer.href ?? customer.id}
                    type="button"
                    onClick={() => {
                      updateDraft("customerHref", customer.href ?? "");
                      updateDraft("customerName", customer.name);
                      updateDraft("customerPhone", customer.phone ?? "");
                      updateDraft("customerAddress", customer.actualAddress ?? "");
                    }}
                  >
                    <strong>{customer.name}</strong>
                    <span>{[customer.phone, customer.actualAddress].filter(Boolean).join(" · ") || "Без телефона"}</span>
                  </button>
                ))}
              </div>
            ) : null}
          </>
        ) : null}
        {draft.customerMode !== "retail" || draft.deliveryEnabled ? (
          <div className={styles.formGrid}>
            <label>
              Имя клиента
              <input value={draft.customerName} onChange={(event) => updateDraft("customerName", event.target.value)} />
            </label>
            <label>
              Телефон
              <input value={draft.customerPhone} onChange={(event) => updateDraft("customerPhone", event.target.value)} />
            </label>
            <label>
              Адрес клиента
              <input value={draft.customerAddress} onChange={(event) => updateDraft("customerAddress", event.target.value)} />
            </label>
          </div>
        ) : null}
        <label className={styles.deliveryToggle}>
          <input type="checkbox" checked={draft.deliveryEnabled} onChange={(event) => updateDraft("deliveryEnabled", event.target.checked)} />
          <span>
            <Truck size={18} />
            Доставка
          </span>
          <small>{draft.deliveryEnabled ? "Будет создана задача доставки" : "Без доставки"}</small>
        </label>
        {draft.deliveryEnabled ? (
          <div className={styles.formGrid}>
            <label>
              Дата
              <input type="date" value={draft.deliveryDate} onChange={(event) => updateDraft("deliveryDate", event.target.value)} />
            </label>
            <label>
              Время
              <input type="time" value={draft.deliveryTime} onChange={(event) => updateDraft("deliveryTime", event.target.value)} />
            </label>
            <label>
              Адрес доставки
              <input value={draft.deliveryAddress} onChange={(event) => updateDraft("deliveryAddress", event.target.value)} />
            </label>
            <label>
              Комментарий
              <input value={draft.deliveryNotes} onChange={(event) => updateDraft("deliveryNotes", event.target.value)} />
            </label>
          </div>
        ) : null}
      </section>

      <aside className={styles.summary}>
        <div>
          <span>Сумма товара</span>
          <strong>{money(Number(calculation?.baseTotal ?? baseTotal))}</strong>
        </div>
        <div>
          <span>Оплачено сразу</span>
          <strong>{money(Number(calculation?.prepaidTotal ?? 0))}</strong>
        </div>
        <div>
          <span>Остаток</span>
          <strong>{money(Number(calculation?.installmentBase ?? 0))}</strong>
        </div>
        <div>
          <span>Комиссия</span>
          <strong>{money(Number(calculation?.commission ?? 0))}</strong>
        </div>
        <div>
          <span>К оплате</span>
          <strong>{money(finalTotal)}</strong>
        </div>
        <div>
          <span>Платеж в месяц</span>
          <strong>{money(Number(calculation?.monthlyPayment ?? 0))}</strong>
        </div>
        <section className={styles.receiptBox}>
          <div className={styles.receiptHead}>
            <ReceiptText size={18} />
            <div>
              <strong>Фото чека</strong>
              <small>{receiptFile ? receiptFile.name : mode === "debt" ? "Необязательно для продажи в долг" : "Сфоткайте чек или выберите изображение"}</small>
            </div>
          </div>
          <div className={styles.receiptActions}>
            <button type="button" onClick={openWebCamera}>
              <Camera size={17} />
              Веб-камера
            </button>
            <button type="button" onClick={() => cameraInputRef.current?.click()}>
              <Camera size={17} />
              Сфоткать
            </button>
            <button type="button" onClick={() => galleryInputRef.current?.click()}>
              <ImagePlus size={17} />
              Выбрать
            </button>
          </div>
          {cameraError ? <small className={styles.receiptError}>{cameraError}</small> : null}
          <input
            ref={cameraInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            onChange={(event) => selectReceiptFile(event.target.files?.[0])}
          />
          <input ref={galleryInputRef} type="file" accept="image/*" onChange={(event) => selectReceiptFile(event.target.files?.[0])} />
        </section>
        <div className={styles.summaryActions}>
          <button type="button" onClick={runCalculation} disabled={!draft.items.length || calculateMutation.isPending}>
            <PackagePlus size={18} />
            {calculateMutation.isPending ? "Считаю..." : "Рассчитать"}
          </button>
          <button
            type="button"
            onClick={() => {
              try {
                openConfirmModal();
              } catch (error) {
                showToast({ tone: "error", title: "Проверьте продажу", description: getErrorText(error) });
              }
            }}
            disabled={orderMutation.isPending}
          >
            {orderMutation.isPending ? "Создаю..." : mode === "debt" ? "Создать отгрузку" : "Создать документ"}
          </button>
        </div>
      </aside>
      {confirmModal ? (
        <div className={styles.confirmOverlay} role="presentation" onMouseDown={() => setConfirmModal(null)}>
          <section
            className={styles.confirmModal}
            role="dialog"
            aria-modal="true"
            aria-labelledby="sale-confirm-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header>
              <div>
                <strong id="sale-confirm-title">{confirmModal.title}</strong>
                <span>{confirmModal.subtitle}</span>
              </div>
              <button type="button" aria-label="Закрыть окно подтверждения" onClick={() => setConfirmModal(null)}>
                <X size={18} />
              </button>
            </header>
            <div className={styles.confirmSummary}>
              <article className={styles.confirmTotalCard}>
                <span>К оплате</span>
                <strong>{money(confirmModal.total)}</strong>
              </article>
              <article>
                <span>Документ</span>
                <strong>{confirmModal.documentLabel}</strong>
              </article>
              <article>
                <span>Клиент</span>
                <strong>{confirmModal.customerName}</strong>
              </article>
              <article>
                <span>Оплата</span>
                <strong>{confirmModal.paymentLabel}</strong>
              </article>
            </div>
            <div className={styles.confirmActions}>
              <button type="button" onClick={() => setConfirmModal(null)}>
                Отмена
              </button>
              <button
                type="button"
                onClick={() => {
                  setConfirmModal(null);
                  submitOrder().catch((error) => showToast({ tone: "error", title: "Проверьте продажу", description: getErrorText(error) }));
                }}
              >
                {mode === "debt" ? "Создать отгрузку" : "Создать документ"}
              </button>
            </div>
          </section>
        </div>
      ) : null}
      {cameraOpen ? (
        <div className={styles.cameraOverlay} role="dialog" aria-modal="true" aria-label="Съемка чека">
          <section className={styles.cameraModal}>
            <header>
              <div>
                <strong>Сфоткать чек</strong>
                <span>Наведи камеру на чек и сделай снимок.</span>
              </div>
              <button type="button" aria-label="Закрыть камеру" onClick={stopCamera}>
                <X size={18} />
              </button>
            </header>
            <video ref={videoRef} playsInline muted />
            <footer>
              <button type="button" onClick={stopCamera}>
                Отмена
              </button>
              <button type="button" onClick={captureReceiptPhoto}>
                <Camera size={18} />
                Сделать фото
              </button>
            </footer>
          </section>
        </div>
      ) : null}
      {successModal ? (
        <div className={styles.successOverlay} role="presentation" onMouseDown={() => setSuccessModal(null)}>
          <section
            className={styles.successModal}
            role="dialog"
            aria-modal="true"
            aria-labelledby="sale-success-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header>
              <div>
                <strong id="sale-success-title">Документ создан</strong>
                <span>
                  {successModal.documentType === "retaildemand" ? "Продажа" : "Отгрузка"} №{successModal.documentName}
                </span>
              </div>
              <button type="button" aria-label="Закрыть окно" onClick={() => setSuccessModal(null)}>
                <X size={18} />
              </button>
            </header>
            <div className={styles.successSummary}>
              <article className={styles.successHighlight}>
                <span>{successModal.documentType === "retaildemand" ? "Продажа" : "Отгрузка"}</span>
                <strong>№{successModal.documentName}</strong>
              </article>
              <article>
                <span>Сумма</span>
                <strong>{money(successModal.finalTotal)}</strong>
              </article>
              <article>
                <span>Клиент</span>
                <strong>{successModal.customerName || "Розничный покупатель"}</strong>
              </article>
              <article>
                <span>Оплата</span>
                <strong>{successModal.paymentLabel || "-"}</strong>
              </article>
              <article>
                <span>Сотрудник</span>
                <strong>{successModal.employeeName || "-"}</strong>
              </article>
            </div>
            <div className={styles.successActions}>
              <button
                type="button"
                onClick={() => {
                  try {
                    printReceipt(successModal);
                  } catch (error) {
                    showToast({ tone: "error", title: "Не удалось открыть печать", description: getErrorText(error) });
                  }
                }}
              >
                Распечатать чек
              </button>
              <button
                type="button"
                onClick={() => {
                  if (successModal.documentUrl) {
                    window.open(successModal.documentUrl, "_blank", "noopener,noreferrer");
                    return;
                  }
                  window.location.href = "/reports";
                }}
              >
                Перейти к документу
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
