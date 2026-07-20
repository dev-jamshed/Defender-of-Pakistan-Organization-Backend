import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller';
import { AppService } from './app.service';

describe('AppController', () => {
  let appController: AppController;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [AppService],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  describe('root', () => {
    it('should return the DPO API descriptor', () => {
      expect(appController.getHello()).toMatchObject({
        name: 'Defenders of Pakistan Organization API',
        shortCode: 'DPO',
        status: 'running',
      });
    });
  });
});
