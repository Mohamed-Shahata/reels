import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export const VIDEO_LANGUAGES = ['ar', 'en'] as const;
export type VideoLanguage = (typeof VIDEO_LANGUAGES)[number];

export const CONTENT_TYPES = ['SOLO', 'PODCAST'] as const;
export type VideoContentType = (typeof CONTENT_TYPES)[number];

export class CreateVideoDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(1, { message: 'title must not be empty' })
  @MaxLength(255)
  title!: string;

  @IsOptional()
  @IsIn(CONTENT_TYPES, { message: 'contentType must be one of: SOLO, PODCAST' })
  contentType?: VideoContentType;

  @IsOptional()
  @IsIn(VIDEO_LANGUAGES, { message: 'language must be one of: ar, en' })
  language?: VideoLanguage;

  @IsOptional()
  @IsBoolean()
  autoClips?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  filename?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  contentTypeHeader?: string;

  @IsOptional()
  @IsInt()
  @IsPositive()
  sizeBytes?: number;
}
