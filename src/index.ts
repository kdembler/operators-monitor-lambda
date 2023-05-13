import { Handler } from "aws-lambda";
import { GraphQLClient } from "graphql-request";
import { GetTestVideo } from "./queries";
import { GetVideosQuery, StorageDataObjectFieldsFragment } from "./gql/graphql";

const apiUrl = "https://orion.joystream.org/graphql";
const client = new GraphQLClient(apiUrl);
const verbose = false;

const log = (...args: any[]) => {
  if (verbose) {
    console.log(...args);
  }
};

export const run: Handler = async function run(event, context) {
  const time = new Date();
  log(
    `Starting run "${context.functionName}" in "${process.env.AWS_REGION}" at ${time}`
  );

  let testVideo: GetVideosQuery["videos"][number];
  try {
    const offset = Math.floor(Math.random() * 995) + 5;
    const res = await client.request(GetTestVideo, { limit: 1, offset });
    testVideo = res.videos[0];
  } catch (e) {
    console.error("Failed to fetch test video");
    console.error(e);
    return;
  }
  if (!testVideo?.media || !testVideo?.thumbnailPhoto) {
    throw new Error("No test video found");
  }

  const isUsingMedia = Math.random() > 0.5;
  const dataObject = isUsingMedia
    ? (testVideo.media as StorageDataObjectFieldsFragment)
    : (testVideo.thumbnailPhoto as StorageDataObjectFieldsFragment);

  const getTestsFromDataObject = (
    dataObject: StorageDataObjectFieldsFragment
  ): TestInput[] => {
    return dataObject.storageBag.distributionBuckets.flatMap((bucket) => {
      return bucket.distributionBucket.operators
        .filter((op) => !!op.metadata?.nodeEndpoint)
        .map((op) => ({
          dataObjectId: dataObject.id,
          distributionBucketId: bucket.distributionBucket.id,
          workerId: op.workerId,
          nodeEndpoint: op.metadata!.nodeEndpoint!,
          region: process.env.AWS_REGION!,
          dataObjectType: isUsingMedia ? "media" : "thumbnail",
        }));
    });
  };

  const tests: TestInput[] = getTestsFromDataObject(dataObject);

  const results = await Promise.all(tests.map(runTest));

  for (const r of results) {
    if (r.status === "success") {
      log(`${r.url} - success - ${r.responseTime}ms`);
    } else if (r.status === "timeout") {
      log(`${r.url} - timeout`);
    } else {
      log(`${r.url} - failure - ${r.statusCode}`);
    }
  }

  await sendResults(results);
};

type TestInput = {
  dataObjectId: string;
  dataObjectType: "media" | "thumbnail";
  region: string;
  distributionBucketId: string;
  workerId: number;
  nodeEndpoint: string;
};
type TestResult = TestInput & { url: string; time: Date } & (
    | { status: "success"; responseTime: number }
    | { status: "failure"; statusCode?: number }
    | { status: "timeout" }
  );

async function runTest(test: TestInput): Promise<TestResult> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), 5000);
  const time = new Date();
  const start = performance.now();
  const url = `${test.nodeEndpoint}api/v1/assets/${test.dataObjectId}`;
  const commonFields = {
    ...test,
    time,
    url,
  };
  try {
    const res = await fetch(url, {
      method: "HEAD",
      signal: controller.signal,
    });
    clearTimeout(id);
    const end = performance.now();
    if (!res.ok) {
      return { ...commonFields, status: "failure", statusCode: res.status };
    }
    return { ...commonFields, status: "success", responseTime: end - start };
  } catch (e) {
    const isAbortError = e instanceof DOMException && e.name === "AbortError";
    if (isAbortError) {
      return { ...commonFields, status: "timeout" };
    }
    if (!e.status) {
      console.error(test);
      console.error(e);
    }
    return { ...commonFields, status: "failure", statusCode: e.status };
  }
}

async function sendResults(results: TestResult[]) {
  const metricsApiUrl = process.env.METRICS_API_URL;
  if (!metricsApiUrl) {
    console.error("METRICS_API_URL not set");
    return;
  }
  log(`Sending ${results.length} results to metrics API at ${metricsApiUrl}`);
  const res = await fetch(metricsApiUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(results),
  });
  if (!res.ok) {
    console.error(
      `Failed to send results to metrics API with status ${res.status}`
    );
    console.error(await res.text());
  }
  console.log(`Sent`);
}
