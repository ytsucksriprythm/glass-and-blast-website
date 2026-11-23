export type SmartActionKind = 'reschedule' | 'schedule' | 'send-invoice' | 'send-quote' | 'clarify' | 'invoice' | 'reply' | 'quote' | 'booking' | 'repeat';

export type SmartRecipient = { name: string; phone: string; message: string };

export type SmartAction = {
  id: string;
  kind: SmartActionKind;
  title: string;
  description: string;
  recipients: SmartRecipient[];
  bulk?: boolean;
  customerSms?: string;
  calendarOnly?: boolean;
  messageId?: string;
};

export type SmartActionResult = {
  id: string;
  status: 'queued' | 'submitted' | 'failed' | 'skipped';
  detail: string;
};

export type SmartActionRecord = {
  id: string;
  status: 'executing' | 'completed' | 'dismissed' | 'failed' | 'expired';
  actor: string;
  updatedAt: string;
  results: SmartActionResult[];
};
