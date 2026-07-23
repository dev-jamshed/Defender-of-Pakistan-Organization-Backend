import { Injectable, UnauthorizedException } from '@nestjs/common';
import {
  createHmac,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from 'node:crypto';

export type AuthUser = {
  id: string;
  name: string;
  email: string;
  role: string;
};

type TokenPayload = AuthUser & {
  exp: number;
};

@Injectable()
export class AuthService {
  private readonly issuer = 'dpo-admin';

  hashPassword(password: string, salt = randomBytes(16).toString('hex')) {
    return `scrypt:${salt}:${scryptSync(password, salt, 64).toString('hex')}`;
  }

  verifyPassword(password: string, storedHash: unknown) {
    if (typeof storedHash !== 'string') return false;
    const [scheme, salt, hash] = storedHash.split(':');
    if (scheme !== 'scrypt' || !salt || !hash) return false;
    const expected = Buffer.from(hash, 'hex');
    const actual = scryptSync(password, salt, expected.length);
    return (
      expected.length === actual.length && timingSafeEqual(expected, actual)
    );
  }

  signToken(user: AuthUser) {
    const payload: TokenPayload = {
      ...user,
      exp: Math.floor(Date.now() / 1000) + 60 * 60 * 8,
    };
    const encodedPayload = this.base64Url(JSON.stringify(payload));
    const signature = this.sign(encodedPayload);
    return `${encodedPayload}.${signature}`;
  }

  verifyToken(token: string) {
    const [encodedPayload, signature] = token.split('.');
    if (
      !encodedPayload ||
      !signature ||
      this.sign(encodedPayload) !== signature
    ) {
      throw new UnauthorizedException('Invalid auth token');
    }
    const payload = JSON.parse(
      Buffer.from(encodedPayload, 'base64url').toString('utf8'),
    ) as TokenPayload;
    if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) {
      throw new UnauthorizedException('Auth token expired');
    }
    return payload;
  }

  private sign(value: string) {
    return createHmac('sha256', this.secret())
      .update(`${this.issuer}.${value}`)
      .digest('base64url');
  }

  private secret() {
    return process.env.DPO_AUTH_SECRET ?? 'change-this-dpo-auth-secret';
  }

  private base64Url(value: string) {
    return Buffer.from(value, 'utf8').toString('base64url');
  }
}
