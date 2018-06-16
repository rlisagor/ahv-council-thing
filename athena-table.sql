CREATE EXTERNAL TABLE IF NOT EXISTS letterbuilder.letters (
  `id` string,
  `approvedTimestampUTC` timestamp,
  `projectid` string,
  `sender` string,
  `recipients` array<string>,
  `join_list` boolean,
  `subject` string,
  `body` string 
)
ROW FORMAT SERDE 'org.openx.data.jsonserde.JsonSerDe'
WITH SERDEPROPERTIES (
  'serialization.format' = '1'
) LOCATION 's3://ahv-letter-builder-logging/letters'
TBLPROPERTIES ('has_encrypted_data'='false');
