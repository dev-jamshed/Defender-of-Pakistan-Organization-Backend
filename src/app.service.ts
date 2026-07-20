import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  getHello() {
    return {
      name: 'Defenders of Pakistan Organization API',
      shortCode: 'DPO',
      status: 'running',
      docs: {
        health: '/api/health',
        dashboard: '/api/admin/dashboard',
        schemas: '/api/admin/schemas',
        database: '/api/admin/database/status',
      },
    };
  }
}
