import { BUSINESS_DEFAULTS, PAYMENT_DEFAULTS, SEED_PAYMENT_PROFILES, type BusinessProfile, type PaymentProfile } from './invoice';
import { STAFF_PROFILES, type StaffProfile } from './staff';

const blankBusiness = { fromName: '', fromTradingAs: '', fromAbn: '', fromAddress: '', fromEmail: '', fromPhone: '' };
const blankPayment = { payAccountName: '', payBsb: '', payAccountNumber: '' };

export function documentBusinessDefaults(staff: StaffProfile | null | undefined, profiles: BusinessProfile[], enabled = true) {
  if (!enabled) return blankBusiness;
  const profile = staff
    ? profiles.find(item => item.id === staff + '-business') ??
      profiles.find(item => item.name.trim().toLowerCase() === STAFF_PROFILES[staff].toLowerCase())
    : profiles[0];
  if (profile) {
    const { fromName, fromTradingAs, fromAbn, fromAddress, fromEmail, fromPhone } = profile;
    return { fromName, fromTradingAs, fromAbn, fromAddress, fromEmail, fromPhone };
  }
  return staff === 'liam'
    ? { ...blankBusiness, fromName: 'Liam Ward', fromTradingAs: BUSINESS_DEFAULTS.fromTradingAs }
    : BUSINESS_DEFAULTS;
}

export function documentPaymentDefaults(staff: StaffProfile | null | undefined, profiles: PaymentProfile[], enabled = true) {
  if (!enabled) return blankPayment;
  const profile = staff
    ? profiles.find(item => item.id === staff) ??
      profiles.find(item => item.name.trim().toLowerCase() === STAFF_PROFILES[staff].toLowerCase()) ??
      SEED_PAYMENT_PROFILES.find(item => item.id === staff)
    : profiles[0];
  return profile
    ? { payAccountName: profile.accountName, payBsb: profile.bsb, payAccountNumber: profile.accountNumber }
    : PAYMENT_DEFAULTS;
}
