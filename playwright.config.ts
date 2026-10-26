import {defineConfig,devices} from '@playwright/test';
export default defineConfig({
 testDir:'./e2e',
 testMatch:'treasury-cheque-bounce.spec.ts',
 timeout:60000,
 retries:0,
 use:{baseURL:process.env.E2E_BASE_URL||'http://localhost:3000',...devices['Desktop Chrome']},
 reporter:'list',
});
