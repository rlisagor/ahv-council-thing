GENERATOR_URL="https://next.json-generator.com/api/json/get/E1j7Vng0N"
FILE_NAME_PREFIX="fakedata"
echo $FILE_NAME_PREFIX
curl "https://next.json-generator.com/api/json/get/E1j7Vng0N" | jq -c -r .[] | split -l 1 - "${FILE_NAME_PREFIX}"

for file in "$FILE_NAME_PREFIX"*
do
    mv "$file" "$file.json"
done