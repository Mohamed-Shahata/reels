import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export const VIDEO_LANGUAGES = ['ar', 'en'] as const;
export type VideoLanguage = (typeof VIDEO_LANGUAGES)[number];

export class CreateVideoDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(1, { message: 'title must not be empty' })
  @MaxLength(255)
  title!: string;

  @IsOptional()
  @IsIn(VIDEO_LANGUAGES, { message: 'language must be one of: ar, en' })
  language?: VideoLanguage;

  @IsOptional()
  @IsBoolean()
  autoClips?: boolean;
}
