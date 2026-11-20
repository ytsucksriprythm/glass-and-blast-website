export const STAFF_PROFILES = { liam: 'Liam', lincoln: 'Lincoln' } as const;
export type StaffProfile = keyof typeof STAFF_PROFILES;

export function isStaffProfile(value: unknown): value is StaffProfile {
  return value === 'liam' || value === 'lincoln';
}

export function staffLabel(profile: StaffProfile, channel?: 'chatgpt' | 'claude' | 'connector') {
  return STAFF_PROFILES[profile] + (channel ? ' (' + channel + ')' : '');
}
