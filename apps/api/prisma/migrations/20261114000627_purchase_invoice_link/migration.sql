-- AlterTable
ALTER TABLE "Purchase" ADD COLUMN     "invoiceId" TEXT;

-- CreateIndex
CREATE INDEX "Purchase_invoiceId_idx" ON "Purchase"("invoiceId");

-- AddForeignKey
ALTER TABLE "Purchase" ADD CONSTRAINT "Purchase_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;
