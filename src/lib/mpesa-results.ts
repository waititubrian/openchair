// What M-Pesa result codes mean, in words customers and shop owners can act on.

/** Why a prompt failed, as a short machine-readable reason. */
export function failureReason(resultCode: number): string {
  switch (resultCode) {
    case 1032:
      return "cancelled"; // the customer dismissed the prompt
    case 1:
      return "insufficient_funds";
    case 2001:
      return "wrong_pin";
    case 1037:
      return "no_response"; // the phone never answered (timeout)
    case 1025:
    case 1019:
      return "prompt_failed";
    default:
      return "failed";
  }
}

/** The sentence shown to the person paying. */
export function failureMessage(reason: string | null | undefined): string {
  switch (reason) {
    case "cancelled":
      return "You cancelled the M-Pesa prompt.";
    case "insufficient_funds":
      return "Your M-Pesa balance was too low for this payment.";
    case "wrong_pin":
      return "The M-Pesa PIN was not accepted.";
    case "no_response":
    case "expired":
      return "We didn't get a response from your phone in time.";
    default:
      return "The M-Pesa payment didn't go through.";
  }
}
