'use client';

import type { Quote } from '@/lib/quote';
import type { Invoice } from '@/lib/invoice';
import DocumentDialog from './DocumentDialog';
import SmsPanel from './SmsPanel';

export type DocumentSmsTarget = { kind: 'quote' | 'invoice' | 'booking'; id: string; draft?: boolean };

export default function DocumentSmsDialog({ target, onClose, onQuoteApproved, onInvoiceApproved }: {
  target: DocumentSmsTarget; onClose: () => void; onQuoteApproved?: (quote: Quote) => void; onInvoiceApproved?: (invoice: Invoice) => void;
}) {
  return (
    <DocumentDialog title="Send via SMS" onClose={onClose}>
      <SmsPanel kind={target.kind} recordId={target.id} needsApproval={target.draft}
        onQuoteApproved={onQuoteApproved} onInvoiceApproved={onInvoiceApproved} />
    </DocumentDialog>
  );
}
