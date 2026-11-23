import type { SmartAction } from './smartActionTypes';

const samplePhone = '+61491570006';
const recipient = (name: string, message: string, phone = samplePhone) => ({
  name, phone, message: 'Glass & Blast\n\n' + message + '\n\nReply STOP to opt out.',
});

export const smartActionExamples: SmartAction[] = [
  {
    id: 'demo-reschedule', kind: 'reschedule', title: 'Move Sarah’s booking',
    description: 'Move the sample window clean to Thursday at 10 am and preview the confirmation.',
    customerSms: 'Could we move my window clean to Thursday at 10 am?',
    recipients: [recipient('Sarah Demo', 'Hi Sarah, your window clean is confirmed for Thursday at 10 am.')],
  },
  {
    id: 'demo-invoice', kind: 'invoice', title: 'John Demo · $480 overdue',
    description: 'Sample invoice GB-DEMO-01 is 30 days overdue.',
    recipients: [recipient('John Demo', 'Hi John, a friendly reminder that sample invoice GB-DEMO-01 is overdue.')],
  },
  {
    id: 'demo-reply', kind: 'reply', title: 'Reply to Riley',
    description: 'Riley asked whether flyscreens can be cleaned with the windows.',
    customerSms: 'Can you clean the flyscreens while you’re here?',
    recipients: [recipient('Riley Demo', 'Hi Riley, thanks for asking. Could you let us know how many flyscreens you’d like cleaned?')],
  },
  {
    id: 'demo-quotes', kind: 'quote', title: 'Follow up 2 unbooked quotes',
    description: 'Review two sample customers and their follow-up messages.', bulk: true,
    recipients: [
      recipient('Alex Demo', 'Hi Alex, are you still interested in going ahead with your window cleaning quote?'),
      recipient('Casey Demo', 'Hi Casey, would you like us to organise a time for the driveway clean?', '+61491570156'),
    ],
  },
  {
    id: 'demo-repeat', kind: 'repeat', title: 'Check in with Taylor',
    description: 'Previous sample cleans suggest it may be time for another visit.',
    recipients: [recipient('Taylor Demo', 'Hi Taylor, would you like to organise another window clean?')],
  },
];
