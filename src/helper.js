const request = require('request-promise-native');

exports.extractEmailAddress = function(slackFieldValue) {
  var regex = /<mailto:([^|]*?)(?:\|.*)?>/i;
  var matchResults = slackFieldValue.trim().match(regex);

  if(!matchResults) {
    console.log(`Could not find a match in ${slackFieldValue}. Returning ${slackFieldValue} as-is.`);
    return slackFieldValue;
  }

  return matchResults[1];
};

exports.splitFullName = function(fullName) {
  const spl = fullName.split(/[\s.,;]+/).map(n => n.trim());

  if (spl.length > 1) {
    const lastName = spl.pop();
    return [spl.join(' '), lastName];
  } else if (spl.length === 1) {
    return [...spl, ''];
  } else {
    return ['', ''];
  }
};

exports.badRequestResponse =  function(message, cors) {
  const log = `Bad request: ${message}`;
  console.log(log);

  const result = {
    statusCode: 400,
    body: log
  };

  if (cors) {
    result.headers = {
      'Access-Control-Allow-Origin': '*'
    };
  }

  return result;
}

exports.errorToSlack = async function(responseUrl, err) {
  try {
    return await request.post({
      url: responseUrl,
      body: {
        'response_type': 'ephemeral',
        'replace_original': false,
        'text': 'Error: ' + err.toString()
      },
      json: true
    });
  } catch (err) {
    console.error('Failed to send error to Slack: ', err);
  }
}