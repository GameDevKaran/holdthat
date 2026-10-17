import {defineConfig,devices} from '@playwright/test';
export default defineConfig({
 testDir:'tests/browser',fullyParallel:false,workers:1,timeout:30000,
 use:{baseURL:'http://127.0.0.1:3211',trace:'retain-on-failure',screenshot:'only-on-failure'},
 projects:[{name:'desktop',use:{...devices['Desktop Chrome'],viewport:{width:1440,height:1050}}},{name:'mobile',use:{...devices['Pixel 7']}}],
});
