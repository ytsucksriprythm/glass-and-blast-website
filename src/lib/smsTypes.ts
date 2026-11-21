import { STAFF_PROFILES, type StaffProfile } from './staff';

export const SMS_READ_EVENT = 'crm:sms-read';

export type SmsReadState = Partial<Record<StaffProfile, { id: string; createdAt: string; readAt: string }>>;
export type SmsReadReceipt = { profile: StaffProfile; source: 'crm' | 'chatgpt' };

export function smsReadLabel({ profile, source }: SmsReadReceipt): string {
  return source === 'crm' ? 'Read - ' + STAFF_PROFILES[profile] : 'Seen via ChatGPT for ' + STAFF_PROFILES[profile];
}

export function smsReadReceipts(state: SmsReadState | undefined, chatgpt: StaffProfile[] | undefined, message: Pick<SmsMessage, 'id' | 'createdAt'>): SmsReadReceipt[] {
  const receipts: SmsReadReceipt[] = [];
  for (const profile of ['liam', 'lincoln'] as const) {
    if (hasReadSms(state?.[profile], message)) receipts.push({ profile, source: 'crm' });
    if (chatgpt?.includes(profile)) receipts.push({ profile, source: 'chatgpt' });
  }
  return receipts;
}

export function hasReadSms(marker: Pick<SmsMessage, 'id' | 'createdAt'> | undefined, message: Pick<SmsMessage, 'id' | 'createdAt'>) {
  return Boolean(marker && (marker.createdAt > message.createdAt ||
    (marker.createdAt === message.createdAt && marker.id >= message.id)));
}

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
  unread?: boolean;
  latestIncomingReceipts?: SmsReadReceipt[];
};

export function smsPhone(input: string): string | null {
  return australianMobile(input) ?? (/^\+[1-9]\d{7,14}$/.test(input) ? input : null);
}
export function australianMobile(input: string): string | null {
  const digits = input.trim().replace(/^p:\s*/i, '').replace(/[\s().-]/g, '');
  const match = /^(?:\+61|0061|61|0)(4\d{8})$/.exec(digits);
  return match ? '+61' + match[1] : null;
}
