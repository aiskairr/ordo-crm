"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Camera, CreditCard, ImagePlus, PackagePlus, ReceiptText, Search, Truck, Trash2, UserRound, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Customer } from "@/src/fsd/entities/customer";
import type { Product } from "@/src/fsd/entities/product";
import { StatusPanel } from "@/src/fsd/shared/ui/status";
import { useToast } from "@/src/fsd/shared/ui/toast";
import { getErrorText } from "@/src/fsd/shared/lib/errors";
import { printSalesReceipt, type SalesReceiptData } from "@/src/fsd/features/print-sales-receipt";
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

type PaymentPart = {
  localId: string;
  paymentTypeHref: string;
  amount: string;
};

type CreatedOrderResult = {
  document?: {
    id?: string;
    name?: string;
    type?: string;
    webUrl?: string;
    moment?: string;
  };
  order?: {
    moment?: string;
    paid?: number;
    unpaid?: number;
    storeName?: string;
    customerName?: string;
    employeeName?: string;
  };
  calculation?: {
    baseTotal?: number;
    loyaltyRedemption?: number;
    finalTotal?: number;
    prepaidTotal?: number;
    paymentLabel?: string;
    items?: Array<{
      productName?: string;
      name?: string;
      productPrice?: number;
      quantity?: number;
      lineTotal?: number;
      isGift?: boolean;
    }>;
  };
  loyalty?: {
    redeemed?: number;
    accrued?: number;
    balance?: number | null;
  } | null;
  telegramReceipt?: {
    sent?: boolean;
    error?: string;
    photos?: number;
  } | null;
  delivery?: {
    error?: string;
  } | null;
};

type SuccessModalState = SalesReceiptData & {
  documentName: string;
  documentType: string;
  documentUrl: string;
  paymentLabel: string;
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
  salesChannelHref: string;
  secondPaymentTypeHref: string;
  secondBankAmount: string;
  paymentParts: PaymentPart[];
  employeeHref: string;
  retailStoreHref: string;
  customerMode: CustomerMode;
  customerHref: string;
  customerName: string;
  customerPhone: string;
  deliveryPhoneSecondary: string;
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
const maxReceiptPhotos = 10;
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
  salesChannelHref: "",
  secondPaymentTypeHref: "",
  secondBankAmount: "0",
  paymentParts: [],
  employeeHref: "",
  retailStoreHref: "",
  customerMode: "retail",
  customerHref: "",
  customerName: "",
  customerPhone: "",
  deliveryPhoneSecondary: "",
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
    const parsed = saved ? JSON.parse(saved) : {};
    const draft = { ...emptyDraft, ...parsed, paymentParts: Array.isArray(parsed.paymentParts) ? parsed.paymentParts : [] };
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

function parseDraftMoney(value: string) {
  return Number(String(value || "").replace(/\s/g, "").replace(",", "."));
}

function normalizeCreatedOrderResult(
  payload: unknown,
  draft: SalesDraft,
  employeeName: string,
  storeName: string,
): SuccessModalState {
  const record = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  const document = record.document && typeof record.document === "object" ? (record.document as Record<string, unknown>) : {};
  const order = record.order && typeof record.order === "object" ? (record.order as Record<string, unknown>) : {};
  const calculation = record.calculation && typeof record.calculation === "object" ? (record.calculation as Record<string, unknown>) : {};
  const loyalty = record.loyalty && typeof record.loyalty === "object" ? (record.loyalty as Record<string, unknown>) : {};
  const rawItems = Array.isArray(calculation.items) ? calculation.items : [];
  const numberValue = (value: unknown) => {
    const number = Number(value);
    return Number.isFinite(number) ? number : 0;
  };
  const documentName = typeof document.name === "string" ? document.name : "Без номера";
  const finalTotal = numberValue(calculation.finalTotal);
  const paidAmount = numberValue(order.paid ?? calculation.prepaidTotal);
  const receiptItems = rawItems.map((item) => {
    const row = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
    return {
      name: typeof row.productName === "string" ? row.productName : typeof row.name === "string" ? row.name : "Товар",
      price: numberValue(row.productPrice),
      quantity: numberValue(row.quantity) || 1,
      lineTotal: numberValue(row.lineTotal),
      isGift: row.isGift === true,
    };
  });
  const calculatedBaseTotal = receiptItems.reduce((sum, item) => sum + (item.isGift ? 0 : item.lineTotal), 0);

  return {
    documentName,
    documentNumber: documentName,
    documentType: typeof document.type === "string" ? document.type : "demand",
    documentUrl: typeof document.webUrl === "string" ? document.webUrl : "",
    dateTime: typeof document.moment === "string"
      ? document.moment
      : typeof order.moment === "string"
        ? order.moment
        : new Date().toISOString(),
    storeName: typeof order.storeName === "string" && order.storeName ? order.storeName : storeName,
    employeeName: typeof order.employeeName === "string" && order.employeeName ? order.employeeName : employeeName,
    customerName: typeof order.customerName === "string" && order.customerName
      ? order.customerName
      : draft.customerName || "Розничный покупатель",
    baseTotal: numberValue(calculation.baseTotal) || calculatedBaseTotal,
    loyaltyRedemption: numberValue(calculation.loyaltyRedemption || loyalty.redeemed),
    finalTotal,
    paymentLabel: typeof calculation.paymentLabel === "string" ? calculation.paymentLabel : "",
    paymentType: typeof calculation.paymentLabel === "string" ? calculation.paymentLabel : "",
    paidAmount,
    unpaidAmount: numberValue(order.unpaid ?? Math.max(0, finalTotal - paidAmount)),
    accruedBonuses: numberValue(loyalty.accrued),
    bonusBalance: loyalty.balance == null ? null : numberValue(loyalty.balance),
    items: receiptItems,
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

function isMixedPaymentType(paymentType: PaymentTypeOption) {
  return !isDebtPaymentType(paymentType);
}

function createPaymentPart(paymentTypeHref = "", amount = ""): PaymentPart {
  return {
    localId: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    paymentTypeHref,
    amount,
  };
}

function findCashPaymentType(paymentTypes: PaymentTypeOption[]) {
  return paymentTypes.find(isCashPaymentType) ?? paymentTypes[0];
}

function findDebtPaymentType(paymentTypes: PaymentTypeOption[]) {
  return paymentTypes.find(isDebtPaymentType) ?? paymentTypes[0];
}

function branchKeyFromStoreName(name: string): BranchKey {
  const normalized = normalizeLookup(name);
  if (normalized.includes("беш")) return "besh";
  return "ayu";
}

function branchIdsFromStore(store?: RetailStore | null) {
  const branchKey = branchKeyFromStoreName(store?.name || "");
  if (branchKey === "besh") {
    return new Set(["besh", "besh-sary"]);
  }
  return new Set(["ayu", "ayu-grand"]);
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
    employees.find((employee) => Boolean(currentUser.moySkladEmployeeHref) && employee.href === currentUser.moySkladEmployeeHref) ??
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
  if (scenario === "mixed") return paymentTypes.filter(isMixedPaymentType);
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
  salesChannels,
  mode = "sales",
}: {
  config: SalesConfig;
  employees: SelectOption[];
  currentUser: CurrentSalesUser | null;
  retailStores: RetailStore[];
  paymentTypes: PaymentTypeOption[];
  salesChannels: SelectOption[];
  products: Product[];
  customers: Customer[];
  mode?: "sales" | "debt";
}) {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const draftStorageKey = mode === "debt" ? debtDraftKey : salesDraftKey;
  const [draft, setDraft] = useState<SalesDraft>(() => {
    const loaded = loadDraft(draftStorageKey, mode);
    const mixedTypes = visiblePaymentTypes(paymentTypes, "mixed");
    if (loaded.paymentScenario === "mixed" && !loaded.paymentParts.length && mixedTypes.length) {
      return {
        ...loaded,
        paymentParts: [
          createPaymentPart(mixedTypes[0]?.id ?? ""),
          createPaymentPart("", ""),
        ],
      };
    }
    return loaded;
  });
  const [productQuery, setProductQuery] = useState("");
  const [productResults, setProductResults] = useState<Product[]>([]);
  const [customerQuery, setCustomerQuery] = useState("");
  const [customerResults, setCustomerResults] = useState<Customer[]>([]);
  const [calculation, setCalculation] = useState<Record<string, unknown> | null>(null);
  const [receiptFiles, setReceiptFiles] = useState<File[]>([]);
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

    setReceiptFiles((current) => [
      ...current,
      new File([blob], `receipt-${Date.now()}.jpg`, { type: "image/jpeg" }),
    ].slice(0, maxReceiptPhotos));
    stopCamera();
  };

  const selectReceiptFiles = (files: File[]) => {
    if (!files.length) return;
    const images = files.filter((file) => file.type.startsWith("image/"));
    if (images.length !== files.length) {
      showToast({ tone: "error", title: "Нужна фотография", description: "Выберите изображение чека." });
    }
    if (!images.length) return;
    setReceiptFiles((current) => {
      const known = new Set(current.map((file) => `${file.name}:${file.size}:${file.lastModified}`));
      const unique = images.filter((file) => !known.has(`${file.name}:${file.size}:${file.lastModified}`));
      const next = [...current, ...unique].slice(0, maxReceiptPhotos);
      if (current.length + unique.length > maxReceiptPhotos) {
        showToast({ tone: "error", title: "Слишком много чеков", description: `Можно прикрепить максимум ${maxReceiptPhotos} фотографий.` });
      }
      return next;
    });
  };

  const selectedStore = retailStores.find((store) => store.id === draft.retailStoreHref || store.href === draft.retailStoreHref) ?? retailStores[0];
  const branchKey = branchKeyFromStoreName(selectedStore?.name || branches[draft.branchKey]);
  const branchName = selectedStore?.name || branches[branchKey];
  const branchIds = branchIdsFromStore(selectedStore);
  const visibleEmployees = employees.filter((employee) => employeeMatchesBranches(employee, branchIds));
  const canChooseEmployee = currentUser?.role === "admin" || currentUser?.role === "owner";
  const currentEmployee = findCurrentEmployee(visibleEmployees, currentUser);
  const selectedEmployee = canChooseEmployee
    ? visibleEmployees.find((employee) => employee.id === draft.employeeHref || employee.href === draft.employeeHref)
      ?? currentEmployee
      ?? visibleEmployees[0]
      ?? null
    : currentEmployee;
  const visibleTypes = visiblePaymentTypes(paymentTypes, draft.paymentScenario);
  const selectedPaymentType = paymentTypes.find((paymentType) => paymentType.id === draft.paymentTypeHref) ?? visibleTypes[0];
  const secondPaymentType = paymentTypes.find((paymentType) => paymentType.id === draft.secondPaymentTypeHref);
  const selectedSalesChannel = salesChannels.find((channel) => channel.id === draft.salesChannelHref || channel.href === draft.salesChannelHref) ?? salesChannels[0] ?? null;
  const selectedCustomer = customerResults.find((customer) => customer.href === draft.customerHref);
  const mixedPaymentTypes = paymentTypes.filter(isMixedPaymentType);
  const normalizedPaymentParts = draft.paymentScenario === "mixed"
    ? draft.paymentParts
        .map((part) => {
          const paymentType = paymentTypes.find((item) => item.id === part.paymentTypeHref || item.href === part.paymentTypeHref);
          return {
            ...part,
            paymentTypeName: paymentType?.name || "",
            paymentTypeHref: paymentType?.href || paymentType?.id || part.paymentTypeHref,
            paymentTypeRate: paymentType?.rate ?? 0,
            paymentTypeComment: paymentType?.comment || "",
          };
        })
        .filter((part) => part.paymentTypeName || part.amount)
    : [];
  const primaryMixedPaymentType = normalizedPaymentParts[0];
  const secondaryMixedPaymentType = normalizedPaymentParts[1];
  const receiptPhotoOptional = mode === "debt" || draft.paymentScenario === "cash";

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
  }, [productQuery, selectedStore?.id, branchName]);

  useEffect(() => {
    const search = customerQuery.trim();
    if (draft.customerMode !== "existing" || search.length < 2) return;

    const timer = window.setTimeout(() => {
      customerSearchMutation.mutate(search);
    }, 350);

    return () => window.clearTimeout(timer);
    // customerSearchMutation is intentionally omitted: TanStack mutation objects are not stable dependencies.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerQuery, draft.customerMode, branchName]);

  const calculateMutation = useMutation({
    mutationFn: calculateSale,
    onSuccess: (data) => setCalculation(data && typeof data === "object" ? (data as Record<string, unknown>) : null),
  });

  const orderMutation = useMutation({
    mutationFn: createOrder,
    onSuccess: async (result) => {
      const created = result as CreatedOrderResult;
      setSuccessModal(normalizeCreatedOrderResult(
        created,
        draft,
        selectedEmployee?.name || currentUser?.name || "",
        selectedStore?.name || branches[draft.branchKey],
      ));
      showToast({
        tone: "success",
        title: "Документ создан",
        description: created.telegramReceipt?.sent
          ? created.telegramReceipt.photos
            ? `Продажа сохранена в МойСклад, фотографии чеков отправлены в Telegram: ${created.telegramReceipt.photos}.`
            : "Продажа сохранена в МойСклад, информация отправлена в Telegram."
          : "Продажа сохранена в МойСклад.",
      });
      if (created.telegramReceipt?.sent === false) {
        showToast({
          tone: "error",
          title: "Продажа не отправлена в Telegram",
          description: created.telegramReceipt.error || "Telegram отклонил отправку сообщения.",
        });
      }
      if (created.delivery?.error) {
        showToast({ tone: "error", title: "Задача доставки не создана", description: created.delivery.error });
      }
      setDraft(mode === "debt" ? { ...emptyDraft, paymentScenario: "debt", customerMode: "new" } : emptyDraft);
      setCalculation(null);
      setReceiptFiles([]);
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
      cashPrepayment: scenario === "debt" ? current.cashPrepayment : "0",
      prepaymentMethodName: scenario === "cash" ? "Наличными" : current.prepaymentMethodName,
      secondPaymentTypeHref: scenario === "mixed" ? current.secondPaymentTypeHref : "",
      secondBankAmount: scenario === "mixed" ? current.secondBankAmount : "0",
      paymentParts: scenario === "mixed"
        ? current.paymentParts.length
          ? current.paymentParts
          : [
              createPaymentPart(nextType?.id ?? ""),
              createPaymentPart("", ""),
            ]
        : [],
    }));
  };

  const updatePaymentPart = <K extends keyof PaymentPart>(localId: string, field: K, value: PaymentPart[K]) => {
    setDraft((current) => ({
      ...current,
      paymentParts: current.paymentParts.map((part) => (part.localId === localId ? { ...part, [field]: value } : part)),
    }));
  };

  const addPaymentPart = () => {
    setDraft((current) => {
      if (current.paymentParts.length >= 3) return current;
      const used = new Set(current.paymentParts.map((part) => part.paymentTypeHref).filter(Boolean));
      const nextType = mixedPaymentTypes.find((paymentType) => !used.has(paymentType.id));
      return {
        ...current,
        paymentParts: [...current.paymentParts, createPaymentPart(nextType?.id ?? "", "")],
      };
    });
  };

  const removePaymentPart = (localId: string) => {
    setDraft((current) => {
      if (current.paymentParts.length <= 2) return current;
      return { ...current, paymentParts: current.paymentParts.filter((part) => part.localId !== localId) };
    });
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
    paymentTypeName: primaryMixedPaymentType?.paymentTypeName || selectedPaymentType?.name || "",
    paymentTypeHref: primaryMixedPaymentType?.paymentTypeHref || selectedPaymentType?.href || selectedPaymentType?.id || "",
    paymentTypeRate: primaryMixedPaymentType?.paymentTypeRate ?? selectedPaymentType?.rate ?? 0,
    paymentTypeComment: primaryMixedPaymentType?.paymentTypeComment || selectedPaymentType?.comment || "",
    paymentParts: normalizedPaymentParts,
    salesChannelHref: selectedSalesChannel?.href || selectedSalesChannel?.id || "",
    salesChannelName: selectedSalesChannel?.name || "",
    secondPaymentTypeName: secondaryMixedPaymentType?.paymentTypeName || secondPaymentType?.name || "",
    secondPaymentTypeHref: secondaryMixedPaymentType?.paymentTypeHref || secondPaymentType?.href || secondPaymentType?.id || "",
    secondPaymentTypeRate: secondaryMixedPaymentType?.paymentTypeRate ?? secondPaymentType?.rate ?? 0,
    secondPaymentTypeComment: secondaryMixedPaymentType?.paymentTypeComment || secondPaymentType?.comment || "",
    secondBankAmount: secondaryMixedPaymentType?.amount || draft.secondBankAmount,
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
      customerPhoneSecondary: draft.deliveryPhoneSecondary.trim(),
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
    if (draft.paymentScenario === "mixed") {
      if (normalizedPaymentParts.length < 2) throw new Error("Добавьте минимум два способа оплаты.");
      const usedPaymentTypes = new Set<string>();
      for (const part of normalizedPaymentParts) {
        if (!part.paymentTypeName) throw new Error("Выберите способ оплаты в каждой строке.");
        const amount = parseDraftMoney(part.amount);
        if (!Number.isFinite(amount) || amount <= 0) throw new Error("Укажите сумму для каждого способа оплаты.");
        if (usedPaymentTypes.has(part.paymentTypeHref)) throw new Error("В смешанной оплате способы не должны повторяться.");
        usedPaymentTypes.add(part.paymentTypeHref);
      }
    }
    if (!receiptFiles.length && !receiptPhotoOptional) throw new Error("Добавьте фотографию чека.");
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
          : receiptFiles.length
            ? `CRM создаст документ и отправит в Telegram фотографий чеков: ${receiptFiles.length}.`
            : "CRM создаст документ и отправит информацию о наличной продаже в Telegram.",
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
      receiptPhotos: receiptFiles.length ? await Promise.all(receiptFiles.map(readReceiptPhoto)) : undefined,
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
        <h2>Точка продаж и сотрудник</h2>
        <div className={styles.formGrid}>
          <label>
            Точка продаж
            <select
              value={selectedStore?.id ?? selectedStore?.href ?? ""}
              onChange={(event) => {
                const nextStore = retailStores.find((store) => store.id === event.target.value || store.href === event.target.value) ?? null;
                const nextBranchKey = branchKeyFromStoreName(nextStore?.name || "");
                const nextBranchIds = branchIdsFromStore(nextStore);
                const nextEmployees = employees.filter((employee) => employeeMatchesBranches(employee, nextBranchIds));
                const currentEmployeeInNextBranch = nextEmployees.find((employee) => employee.id === draft.employeeHref || employee.href === draft.employeeHref);
                const nextCurrentEmployee = findCurrentEmployee(nextEmployees, currentUser);
                const nextEmployee = canChooseEmployee
                  ? currentEmployeeInNextBranch ?? nextCurrentEmployee ?? nextEmployees[0] ?? null
                  : nextCurrentEmployee;
                setDraft((current) => ({
                  ...current,
                  retailStoreHref: event.target.value,
                  branchKey: nextBranchKey,
                  employeeHref: nextEmployee?.id || nextEmployee?.href || "",
                }));
              }}
            >
              {retailStores.map((store) => (
                <option key={store.id} value={store.id}>
                  {store.name}
                </option>
              ))}
            </select>
          </label>
          {canChooseEmployee ? (
            <label>
              Сотрудник
              <select value={selectedEmployee?.id ?? selectedEmployee?.href ?? ""} onChange={(event) => updateDraft("employeeHref", event.target.value)}>
                {visibleEmployees.length ? visibleEmployees.map((employee) => (
                  <option key={employee.id} value={employee.id}>
                    {employee.name}
                  </option>
                )) : <option value="">Нет сотрудников для этой точки</option>}
              </select>
            </label>
          ) : (
            <label>
              Сотрудник
              <input value={selectedEmployee?.name || currentUser?.name || ""} readOnly />
            </label>
          )}
          {salesChannels.length ? (
            <label>
              Канал продаж
              <select value={selectedSalesChannel?.id ?? selectedSalesChannel?.href ?? ""} onChange={(event) => updateDraft("salesChannelHref", event.target.value)}>
                {salesChannels.map((channel) => (
                  <option key={channel.id} value={channel.id}>
                    {channel.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
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
          {draft.paymentScenario === "bank" ? (
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
          {draft.paymentScenario === "debt" ? (
            <>
              <label>
                Предоплата
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
            </>
          ) : null}
        </div>
        {draft.paymentScenario === "mixed" ? (
          <div className={styles.mixedPaymentGrid}>
            <div className={styles.mixedPaymentHead}>
              <span>Способ</span>
              <span>Сумма</span>
              <span />
            </div>
            {draft.paymentParts.map((part, index) => {
              const usedByOtherRows = new Set(
                draft.paymentParts
                  .filter((item) => item.localId !== part.localId)
                  .map((item) => item.paymentTypeHref)
                  .filter(Boolean),
              );
              return (
                <div key={part.localId} className={styles.mixedPaymentRow}>
                  <select
                    aria-label={`Способ оплаты номер ${index + 1}`}
                    value={part.paymentTypeHref}
                    onChange={(event) => updatePaymentPart(part.localId, "paymentTypeHref", event.target.value)}
                  >
                    <option value="">Выберите способ</option>
                    {mixedPaymentTypes
                      .filter((paymentType) => !usedByOtherRows.has(paymentType.id) || paymentType.id === part.paymentTypeHref)
                      .map((paymentType) => (
                        <option key={paymentType.id} value={paymentType.id}>
                          {paymentType.name}
                        </option>
                      ))}
                  </select>
                  <input
                    aria-label={`Сумма оплаты номер ${index + 1}`}
                    value={part.amount}
                    onChange={(event) => updatePaymentPart(part.localId, "amount", event.target.value)}
                    placeholder="0"
                    inputMode="decimal"
                  />
                  <button
                    type="button"
                    className={styles.mixedPaymentRemove}
                    onClick={() => removePaymentPart(part.localId)}
                    disabled={draft.paymentParts.length <= 2}
                    aria-label="Удалить способ оплаты"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              );
            })}
            <button type="button" className={styles.addPaymentButton} onClick={addPaymentPart} disabled={draft.paymentParts.length >= 3}>
              + Добавить способ оплаты
            </button>
          </div>
        ) : null}
        {draft.paymentScenario === "mixed" ? (
          <div className={styles.bankSplitPreview}>
            {normalizedPaymentParts.map((part, index) => (
              <article key={part.localId}>
                <span>{part.paymentTypeName || `Оплата №${index + 1}`}</span>
                <strong>{money(parseDraftMoney(part.amount) || 0)}</strong>
              </article>
            ))}
          </div>
        ) : null}
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
              Доп. телефон
              <input
                type="tel"
                value={draft.deliveryPhoneSecondary}
                onChange={(event) => updateDraft("deliveryPhoneSecondary", event.target.value)}
                placeholder="Второй номер для курьера"
              />
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
              <small>
                {receiptFiles.length
                  ? `Прикреплено фотографий: ${receiptFiles.length}`
                  : receiptPhotoOptional
                    ? draft.paymentScenario === "cash"
                      ? "Необязательно при оплате наличными"
                      : "Необязательно для продажи в долг"
                    : "Сфоткайте чек или выберите изображение"}
              </small>
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
          {receiptFiles.length ? (
            <div className={styles.receiptFiles}>
              {receiptFiles.map((file, index) => (
                <div key={`${file.name}-${file.lastModified}-${index}`}>
                  <span>{index + 1}. {file.name}</span>
                  <button
                    type="button"
                    aria-label={`Удалить ${file.name}`}
                    onClick={() => setReceiptFiles((current) => current.filter((_, fileIndex) => fileIndex !== index))}
                  >
                    <X size={14} />
                  </button>
                </div>
              ))}
            </div>
          ) : null}
          {cameraError ? <small className={styles.receiptError}>{cameraError}</small> : null}
          <input
            ref={cameraInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            onChange={(event) => {
              selectReceiptFiles(Array.from(event.target.files || []));
              event.currentTarget.value = "";
            }}
          />
          <input
            ref={galleryInputRef}
            type="file"
            accept="image/*"
            multiple
            onChange={(event) => {
              selectReceiptFiles(Array.from(event.target.files || []));
              event.currentTarget.value = "";
            }}
          />
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
                    printSalesReceipt(successModal);
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
