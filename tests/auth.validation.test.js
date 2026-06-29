import { test, describe } from 'node:test';
import assert from 'node:assert';
import { loginSchema, registerSchema } from '../src/validations/auth.validation.js';

describe('Auth Validation', () => {
  describe('Login Schema', () => {
    test('valid payload passes', async () => {
      const payload = {
        body: {
          email: 'test@example.com',
          password: 'Password123!',
        }
      };
      
      const result = await loginSchema.safeParseAsync(payload);
      assert.strictEqual(result.success, true);
    });

    test('invalid email fails', async () => {
      const payload = {
        body: {
          email: 'invalid-email',
          password: 'Password123!',
        }
      };
      
      const result = await loginSchema.safeParseAsync(payload);
      assert.strictEqual(result.success, false);
      assert.strictEqual(result.error.issues[0].path[1], 'email');
    });

    test('unknown field is rejected', async () => {
      const payload = {
        body: {
          email: 'test@example.com',
          password: 'Password123!',
          unknownField: 'malicious',
        }
      };
      
      const result = await loginSchema.safeParseAsync(payload);
      assert.strictEqual(result.success, false);
      assert.strictEqual(result.error.issues[0].code, 'unrecognized_keys');
    });
  });

  describe('Register Schema', () => {
    test('valid payload passes', async () => {
      const payload = {
        body: {
          first_name: 'John',
          last_name: 'Doe',
          email: 'john.doe@example.com',
          password: 'StrongPassword123!',
          country_code: '+44',
          mobile: '7123456789',
        }
      };
      
      const result = await registerSchema.safeParseAsync(payload);
      assert.strictEqual(result.success, true);
    });
  });
});
