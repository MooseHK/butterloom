/**
 * BTRC regulatory constraints:
 * - Sender ID must be 11 characters or fewer.
 * - Text must be in Bengali (OTP codes, numbers and URLs may stay Latin).
 * - Aggregator must be BTRC-enlisted (international routing prohibited).
 */

export interface SmsMessage {
  to: string
  text: string
  transactional?: boolean
}

export interface SmsProvider {
  send(message: SmsMessage): Promise<{ ok: boolean; messageId?: string; error?: string }>
}

export class LoggingSmsProvider implements SmsProvider {
  private readonly senderId: string

  constructor(senderId: string = 'Butterloom') {
    if (senderId.length > 11) {
      throw new Error(`BTRC regulation: sender ID must be <= 11 characters. Got "${senderId}"`)
    }
    this.senderId = senderId
  }

  async send(message: SmsMessage): Promise<{ ok: boolean; messageId?: string }> {
    const id = `sms_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    console.log(`[sms] [${this.senderId}] To: ${message.to} (ID: ${id})`)
    console.log(`[sms] Text: ${message.text}`)
    return { ok: true, messageId: id }
  }
}

export const sms = new LoggingSmsProvider()

/**
 * Bengali notification templates
 */
export function orderPlacedSmsText(orderRef: string, totalTaka: number): string {
  return `বাটারলুম: আপনার অর্ডার ${orderRef} নিশ্চিত হয়েছে। সর্বমোট ৳${totalTaka} (ক্যাশ অন ডেলিভারি)। ধন্যবাদ!`
}

export function orderDispatchedSmsText(orderRef: string, trackingUrl: string): string {
  return `বাটারলুম: আপনার অর্ডার ${orderRef} কুরিয়ারে হস্তান্তর করা হয়েছে। ট্র্যাকিং: ${trackingUrl}`
}
