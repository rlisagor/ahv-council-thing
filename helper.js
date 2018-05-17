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
