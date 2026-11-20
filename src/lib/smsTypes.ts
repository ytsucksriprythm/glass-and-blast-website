export type SmsKind = 'quote' | 'invoice' | 'booking' | 'reminder' | 'manual' | 'reply' | 'staff-alert' | 'welcome';
export type SmsMessage = {
  id: string; kind: SmsKind; recordId: string | null; phone: string; body: string;
  direction: 'inbound' | 'outbound'; status: string; sid?: string; error?: string;
  automatic?: boolean; actor: string; createdAt: string; updatedAt: string;
  retryAt?: string; attempts?: number;
};
export type SmsPreference = 'opted-in' | 'opted-out';
export type SmsConversation = {
  phone: string;
  jobs: { id: string; name: string; address: string; status: string; scheduledAt?: string | null }[];
  latest?: Pick<SmsMessage, 'id' | 'body' | 'direction' | 'createdAt'>;
};

export function smsPhone(input: string): string | null {
  return australianMobile(input) ?? (/^\+[1-9]\d{7,14}$/.test(input) ? input : null);
}
export function australianMobile(input: string): string | null {
  const digits = input.trim().replace(/^p:\s*/i, '').replace(/[\s().-]/g, '');
  const match = /^(?:\+61|0061|61|0)(4\d{8})$/.exec(digits);
  return match ? '+61' + match[1] : null;
}
