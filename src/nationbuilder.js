const request = require('request-promise-native');

const NB_SLUG = process.env.NB_SLUG;
const NB_TOKEN = process.env.NB_TOKEN;
const NB_TAGS = process.env.NB_TAGS ? process.env.NB_TAGS.split(',').map(t => t.trim()) : [];

async function registerPerson(person) {
  console.log('Registering person with NationBuilder');

  return await request(`https://${NB_SLUG}.nationbuilder.com/api/v1/people/push`, {
    method: 'PUT',
    qs: {
      access_token: NB_TOKEN,
    },
    body: {
      person: {
        ...person,
        tags: NB_TAGS,
      }
    },
    json: true,
  });
}

module.exports = {
  registerPerson
};
