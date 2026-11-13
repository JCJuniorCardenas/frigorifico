import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LocalStorageService } from './local-storage.service.js';
import { StorageService } from './storage.service.js';

@Global()
@Module({
  providers: [
    {
      provide: StorageService,
      inject: [ConfigService],
      useFactory: (config: ConfigService): StorageService => {
        const driver = config.get<string>('STORAGE_DRIVER', 'local');
        if (driver !== 'local') {
          throw new Error(`STORAGE_DRIVER "${driver}" no soportado todavía (usar "local").`);
        }
        return new LocalStorageService(config.get<string>('STORAGE_LOCAL_DIR', './storage'));
      },
    },
  ],
  exports: [StorageService],
})
export class StorageModule {}
