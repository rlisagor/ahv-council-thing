exports.extractEmailAddress = function(slackFieldValue) {
  var regex = /<mailto:([^|]*?)(?:\|.*)?>/i;
  var matchResults = slackFieldValue.trim().match(regex);

  if(!matchResults) {
    console.log(`Could not find a match in ${slackFieldValue}. Returning ${slackFieldValue} as-is.`);
    return slackFieldValue;
  }

  return matchResults[1];
};
