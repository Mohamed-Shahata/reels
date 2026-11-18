import { Global, Module } from '@nestjs/common';
import { S3StorageService } from './s3-storage.service';
import { MediaAssetService } from './media-asset.service';

@Global()
@Module({
  providers: [S3StorageService, MediaAssetService],
  exports: [S3StorageService, MediaAssetService],
})
export class StorageModule {}
