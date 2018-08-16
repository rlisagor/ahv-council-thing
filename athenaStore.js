const AWS = require('aws-sdk');
const uuid = require('uuid');
const table = require('table');

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

class AthenaLetterStore {
  constructor({dbName, s3Path, pollInterval}) {
    this.dbName = dbName;
    this.s3Path = s3Path;
    this.pollInterval = pollInterval;

    this.athena = new AWS.Athena();
  }

  async runQuery(query) {
    console.log('Running Athena query:', query);
    const queryID = uuid.v4();

    const startRes = await this.athena.startQueryExecution({
      QueryString: query,
      ResultConfiguration: {
        OutputLocation: this.s3Path,
      },
      ClientRequestToken: queryID,
      QueryExecutionContext: {
        Database: this.dbName,
      }
    }).promise();

    let res;
    while (true) {
      res = await this.athena.getQueryExecution({
        QueryExecutionId: startRes.QueryExecutionId,
      }).promise();

      console.log('State is: ', res.QueryExecution.Status.State);
      if (['SUCCEEDED', 'FAILED', 'CANCELLED'].includes(res.QueryExecution.Status.State)) {
        break;
      }

      await sleep(this.pollInterval);
    }

    if (res.QueryExecution.Status.State === 'FAILED') {
      throw new Error(res.QueryExecution.Status.StateChangeReason);
    }

    res = await this.athena.getQueryResults({
      QueryExecutionId: startRes.QueryExecutionId,
    }).promise();

    return res;
  }

  formatResult(res) {
    const data = res.ResultSet.Rows.map(row => (
      row.Data.map(item => Object.values(item)[0])
    ));

    return table.table(data, {
      drawHorizontalLine: (index, size) => index === 0 || index === 1 || index === size,
    });
  }
}

module.exports.AthenaLetterStore = AthenaLetterStore;
