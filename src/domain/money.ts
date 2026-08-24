export interface MoneyOptions {
  allowNegative?: boolean;
}

export class Money {
  private constructor(
    readonly amount: number,
    readonly currency: string,
  ) {}

  static of(amount: number, currency: string): Money {
    if (!Number.isFinite(amount)) {
      throw new Error("Money amount must be a finite number");
    }
    if (!Number.isInteger(amount)) {
      throw new Error("Money must be expressed in whole minor units");
    }
    if (!/^[a-zA-Z]{3}$/.test(currency)) {
      throw new Error("Currency must be a 3-letter ISO 4217 code");
    }
    return new Money(amount, currency.toUpperCase());
  }

  private assertSameCurrency(other: Money): void {
    if (this.currency !== other.currency) {
      throw new Error(
        `Currency mismatch: ${this.currency} vs ${other.currency}`,
      );
    }
  }

  add(other: Money): Money {
    this.assertSameCurrency(other);
    return Money.of(this.amount + other.amount, this.currency);
  }

  subtract(other: Money, options: MoneyOptions = {}): Money {
    this.assertSameCurrency(other);
    const result = this.amount - other.amount;
    if (result < 0 && !options.allowNegative) {
      throw new Error("Money cannot go negative");
    }
    return Money.of(result, this.currency);
  }

  multiply(quantity: number): Money {
    if (!Number.isInteger(quantity) || quantity < 0) {
      throw new Error("Quantity must be a whole number >= 0");
    }
    return Money.of(this.amount * quantity, this.currency);
  }

  equals(other: Money): boolean {
    return this.amount === other.amount && this.currency === other.currency;
  }

  isLessThanOrEqual(other: Money): boolean {
    this.assertSameCurrency(other);
    return this.amount <= other.amount;
  }
}
