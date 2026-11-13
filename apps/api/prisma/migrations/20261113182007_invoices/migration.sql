-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('PENDING', 'PAID');

-- CreateTable
CREATE TABLE "Invoice" (
    "id" TEXT NOT NULL,
    "salesPoint" TEXT NOT NULL,
    "voucherNumber" TEXT NOT NULL,
    "issueDate" DATE NOT NULL,
    "paymentDueDate" DATE NOT NULL,
    "clientName" TEXT NOT NULL,
    "clientCuit" TEXT NOT NULL,
    "herdNumber" TEXT NOT NULL,
    "slaughterKg" DECIMAL(12,2) NOT NULL,
    "totalAmount" DECIMAL(14,2) NOT NULL,
    "netTaxedAmount" DECIMAL(14,2) NOT NULL,
    "vat21Amount" DECIMAL(14,2) NOT NULL,
    "exemptAmount" DECIMAL(14,2) NOT NULL,
    "cae" TEXT NOT NULL,
    "caeDueDate" DATE NOT NULL,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'PENDING',
    "paidAt" DATE,
    "paidById" TEXT,
    "pdfKey" TEXT NOT NULL,
    "pdfHash" TEXT NOT NULL,
    "needsReview" BOOLEAN NOT NULL DEFAULT false,
    "uploadedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvoiceStatusLog" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "fromStatus" "InvoiceStatus" NOT NULL,
    "toStatus" "InvoiceStatus" NOT NULL,
    "changedById" TEXT NOT NULL,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InvoiceStatusLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_pdfHash_key" ON "Invoice"("pdfHash");

-- CreateIndex
CREATE INDEX "Invoice_herdNumber_idx" ON "Invoice"("herdNumber");

-- CreateIndex
CREATE INDEX "Invoice_clientName_idx" ON "Invoice"("clientName");

-- CreateIndex
CREATE INDEX "Invoice_paymentDueDate_idx" ON "Invoice"("paymentDueDate");

-- CreateIndex
CREATE INDEX "Invoice_status_idx" ON "Invoice"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_salesPoint_voucherNumber_key" ON "Invoice"("salesPoint", "voucherNumber");

-- CreateIndex
CREATE INDEX "InvoiceStatusLog_invoiceId_idx" ON "InvoiceStatusLog"("invoiceId");

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_paidById_fkey" FOREIGN KEY ("paidById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceStatusLog" ADD CONSTRAINT "InvoiceStatusLog_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceStatusLog" ADD CONSTRAINT "InvoiceStatusLog_changedById_fkey" FOREIGN KEY ("changedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
