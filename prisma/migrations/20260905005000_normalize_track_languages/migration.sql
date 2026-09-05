-- Back-catalog CSV imports briefly accepted raw language codes such as `en`.
-- Normalize recognized aliases to ReleaseCore's canonical Track.language values.
UPDATE "Track"
SET "language" = CASE lower(trim("language"))
  WHEN 'en' THEN 'English'
  WHEN 'es' THEN 'Spanish'
  WHEN 'fr' THEN 'French'
  WHEN 'de' THEN 'German'
  WHEN 'it' THEN 'Italian'
  WHEN 'pt' THEN 'Portuguese'
  WHEN 'nl' THEN 'Dutch'
  WHEN 'ar' THEN 'Arabic'
  WHEN 'zh' THEN 'Chinese'
  WHEN 'ja' THEN 'Japanese'
  WHEN 'ko' THEN 'Korean'
  WHEN 'hi' THEN 'Hindi'
  WHEN 'bn' THEN 'Bengali'
  WHEN 'pa' THEN 'Punjabi'
  WHEN 'ur' THEN 'Urdu'
  WHEN 'ru' THEN 'Russian'
  WHEN 'pl' THEN 'Polish'
  WHEN 'tr' THEN 'Turkish'
  WHEN 'el' THEN 'Greek'
  WHEN 'he' THEN 'Hebrew'
  WHEN 'iw' THEN 'Hebrew'
  WHEN 'sv' THEN 'Swedish'
  WHEN 'no' THEN 'Norwegian'
  WHEN 'da' THEN 'Danish'
  WHEN 'fi' THEN 'Finnish'
  WHEN 'is' THEN 'Icelandic'
  WHEN 'cs' THEN 'Czech'
  WHEN 'sk' THEN 'Slovak'
  WHEN 'hu' THEN 'Hungarian'
  WHEN 'ro' THEN 'Romanian'
  WHEN 'uk' THEN 'Ukrainian'
  WHEN 'vi' THEN 'Vietnamese'
  WHEN 'th' THEN 'Thai'
  WHEN 'id' THEN 'Indonesian'
  WHEN 'in' THEN 'Indonesian'
  WHEN 'ms' THEN 'Malay'
  WHEN 'sw' THEN 'Swahili'
  WHEN 'zxx' THEN 'Instrumental / No linguistic content'
  WHEN 'instrumental' THEN 'Instrumental / No linguistic content'
  WHEN 'no linguistic content' THEN 'Instrumental / No linguistic content'
  ELSE "language"
END
WHERE lower(trim("language")) IN (
  'en', 'es', 'fr', 'de', 'it', 'pt', 'nl', 'ar', 'zh', 'ja', 'ko', 'hi',
  'bn', 'pa', 'ur', 'ru', 'pl', 'tr', 'el', 'he', 'iw', 'sv', 'no', 'da',
  'fi', 'is', 'cs', 'sk', 'hu', 'ro', 'uk', 'vi', 'th', 'id', 'in', 'ms',
  'sw', 'zxx', 'instrumental', 'no linguistic content'
);
