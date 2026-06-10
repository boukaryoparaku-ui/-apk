export type User = { id: number; username: string };

export type ManagedUser = { id: number; username: string; createdAt: string };

export type Sku = {
  id: number;
  productId: number;
  styleNo: string;
  productName: string;
  category?: string;
  brand?: string;
  color: string;
  size: string;
  barcode?: string;
  retailPrice?: string;
  isActive: boolean;
  quantity: number;
  soldQuantity: number;
  supplier: string;
  updatedAt: string;
};

export type Movement = {
  id: number;
  type: "INBOUND" | "OUTBOUND";
  quantityChange: number;
  balanceAfter: number;
  createdAt: string;
  operator: string;
  sku: {
    styleNo: string;
    productName: string;
    color: string;
    size: string;
  };
};

export type InventoryRow = {
  key: string;
  styleNo: string;
  productName: string;
  unit: string;
  color: string;
  retailPrice: string;
  total: number;
  soldQuantity: number;
  sizes: Record<string, number>;
  hasNegative: boolean;
};

export type QuickSkuForm = {
  styleNo: string;
  productName: string;
  supplier: string;
  category: string;
  brand: string;
  retailPrice: string;
  colorsText: string;
  sizesText: string;
  quantities: Record<string, string>;
};

export type RecognizedInboundItem = {
  styleNo?: string;
  productName?: string;
  supplier?: string;
  color: string;
  size: string;
  quantity: number;
  unitCost?: string | number;
};

export type SalesOrderPayments = {
  paymentWechat: string;
  paymentCash: string;
  paymentAlipay: string;
  paymentCard: string;
  paymentScan: string;
  paymentTransfer: string;
};

export type SalesOrderLine = {
  id: string;
  styleNo: string;
  productName: string;
  supplier: string;
  category: string;
  brand: string;
  retailPrice: string;
  color: string;
  unitPrice: string;
  note: string;
  sizes: string[];
  quantities: Record<string, string>;
};

export type CustomerOrder = {
  id: number;
  customer: string;
  orderNo: string;
  channel: string;
  orderDate: string;
  note: string;
  status: "PENDING" | "SHIPPED";
  shippedAt?: string | null;
  outboundOrderId?: number | null;
  createdAt: string;
  amountDue: string;
  paidAmount: string;
  unpaidAmount: string;
  changeAmount: string;
  paymentWechat: string;
  paymentCash: string;
  paymentAlipay: string;
  paymentCard: string;
  paymentScan: string;
  paymentTransfer: string;
  items: Array<{
    id: number;
    skuId: number;
    quantity: number;
    unitPrice: string;
    styleNo: string;
    productName: string;
    color: string;
    size: string;
  }>;
};
