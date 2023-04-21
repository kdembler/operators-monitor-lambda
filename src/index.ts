import { Handler } from "aws-lambda";
import { GraphQLClient } from "graphql-request";
import { GetTestVideo } from "./queries";
import { StorageDataObjectFieldsFragment } from "./gql/graphql";

const apiUrl = "https://orion.joystream.org/graphql";
const client = new GraphQLClient(apiUrl);

export const run: Handler = async function run(event, context) {
  const time = new Date();
  console.log(`Your cron function "${context.functionName}" ran at ${time}`);
  const res = await client.request(GetTestVideo, { limit: 10, offset: 500 });
  const testVideo = res.videos[Math.floor(Math.random() * res.videos.length)];
  if (!testVideo?.media || !testVideo?.thumbnailPhoto) {
    throw new Error("No test video found");
  }

  const media = testVideo.media as StorageDataObjectFieldsFragment;
  const thumbnail = testVideo.thumbnailPhoto as StorageDataObjectFieldsFragment;

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
        }));
    });
  };

  const tests: TestInput[] = [
    ...getTestsFromDataObject(media),
    ...getTestsFromDataObject(thumbnail),
  ];

  const results = await Promise.all(tests.map(runTest));

  for (const r of results) {
    if (r.status === "success") {
      console.log(`${r.url} - success - ${r.time}ms`);
    } else if (r.status === "timeout") {
      console.log(`${r.url} - timeout`);
    } else {
      console.log(`${r.url} - failure - ${r.statusCode}`);
    }
  }
};

type TestInput = {
  dataObjectId: string;
  distributionBucketId: string;
  workerId: number;
  nodeEndpoint: string;
};
type TestResult = TestInput & { url: string } & (
    | { status: "success"; time: number }
    | { status: "failure"; statusCode?: number }
    | { status: "timeout" }
  );

async function runTest(test: TestInput): Promise<TestResult> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), 5000);
  const start = performance.now();
  const url = `${test.nodeEndpoint}api/v1/assets/${test.dataObjectId}`;
  try {
    const res = await fetch(url, {
      method: "HEAD",
      signal: controller.signal,
    });
    clearTimeout(id);
    const end = performance.now();
    if (!res.ok) {
      return { ...test, url, status: "failure", statusCode: res.status };
    }
    return { ...test, url, status: "success", time: end - start };
  } catch (e) {
    const isAbortError = e instanceof DOMException && e.name === "AbortError";
    if (isAbortError) {
      return { ...test, url, status: "timeout" };
    }
    return { ...test, url, status: "failure", statusCode: e.status };
  }
}
