export const LARP_SMS_PHONES = ['+61491570006', '+61491570156', '+61491570157', '+61491570158'] as const;
export const LARP_CONTACT_PHONES = ['+61491570159', '+61491570110', '+61491570313', '+61491570737'] as const;

export function isLarpPhone(phone: string) {
  return [...LARP_SMS_PHONES, ...LARP_CONTACT_PHONES].some(example => example === phone);
}
