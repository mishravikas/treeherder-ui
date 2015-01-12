/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, you can obtain one at http://mozilla.org/MPL/2.0/. */

'use strict';


treeherder.factory('thResultSets', ['$rootScope', '$http', '$location', '$q', 'thUrl',
                                    'thEvents', 'thServiceDomain', 'ThLog', 'thNotify','ThJobModel',
    function($rootScope, $http, $location, $q, thUrl,
            thEvents, thServiceDomain, ThLog, thNotify, ThJobModel) {

    var getJobObj = function(job, jobPropertyNames){
        //Map the job property names to their corresponding
        //values in a job object
        var jobObj = {};
        var j = 0;
        for(; j < jobPropertyNames.length; j++){
            jobObj[ jobPropertyNames[j] ] = job[j];
        }
        return jobObj;
    };

    // Convert a flat list of jobs into a structure grouped by
    // platform and job_group. this is mainly to keep compatibility
    // with the previous data structure returned by the api
    var groupJobByPlatform = function(jobList){
        var aggregatedJobs = {platforms:[]}
        if(jobList.length == 0){return aggregatedJobs;}
        aggregatedJobs.id = jobList[0].result_set_id;
        
        for(var i=0; i<jobList.length; i++){
            // search for the right platform
            var job = jobList[i];
            var platform = _.find(aggregatedJobs.platforms, function(platform){
                return job.build_platform == platform.name &&
                 job.platform_option == platform.option;
            })
            if(_.isUndefined(platform)){
                platform = {
                    name: job.build_platform,
                    option: job.platform_option,
                    groups: []
                };
                aggregatedJobs.platforms.push(platform);
            }
            // search for the right group
            var group = _.find(platform.groups, function(group){
                return job.job_group_name == group.name &&
                job.job_group_symbol == group.symbol;
            })
            if(_.isUndefined(group)){
                group = {
                    name: job.job_group_name,
                    symbol: job.job_group_symbol,
                    jobs: []
                };
                platform.groups.push(group);
            }
            group.jobs.push(job);
        }
        return aggregatedJobs;
    };

    var $log = new ThLog("thResultSets");

    // get the resultsets for this repo
    return {
        getResultSetsFromChange: function(repoName, revision){
            return $http.get(
                thUrl.getProjectUrl("/resultset/", repoName),
                {
                    params: {
                        fromchange:revision,
                        format:'json',
                        with_jobs:false
                    }
                }
            );
        },
        getResultSets: function(repoName, rsOffsetTimestamp, count, resultsetlist, with_jobs, full, keep_filters) {
            rsOffsetTimestamp = typeof rsOffsetTimestamp === 'undefined'?  0: rsOffsetTimestamp;
            count = typeof count === 'undefined'?  10: count;
            with_jobs = _.isUndefined(with_jobs) ? true: with_jobs;
            full = _.isUndefined(full) ? true: full;
            keep_filters = _.isUndefined(keep_filters) ? true : keep_filters;

            var params = {
                full: full,
                format: "json",
                with_jobs: with_jobs
            };

            if (count > 0) {
                params.count = count;
            }

            if(rsOffsetTimestamp > 0){
                params.push_timestamp__lte = rsOffsetTimestamp;
                // we will likely re-fetch the oldest we already have, but
                // that's not guaranteed.  There COULD be two resultsets
                // with the same timestamp, theoretically.
                if (params.count) {
                    params.count++;
                }
            }

            if(keep_filters){
                // if there are any search params on the url line, they should
                // pass directly to the set of resultsets.
                // with the exception of ``repo``.  That has no effect on the
                // service at this time, but it could be confusing.
                var locationParams = _.clone($location.search());
                delete locationParams.repo;

                // support date ranges.  we must convert the strings to a timezone
                // appropriate timestamp
                $log.debug("locationParams", locationParams);
                if (_.has(locationParams, "startdate")) {
                    params.push_timestamp__gte = Date.parse(
                        locationParams.startdate)/1000;

                    delete locationParams.startdate;
                }
                if (_.has(locationParams, "enddate")) {
                    params.push_timestamp__lt = Date.parse(
                        locationParams.enddate)/1000 + 84600;

                    delete locationParams.enddate;
                }

                $log.debug("updated params", params);
                _.extend(params, locationParams);
            }

            if (resultsetlist) {
                _.extend(params, {
                    offset: 0,
                    count: resultsetlist.length,
                    id__in: resultsetlist.join()
                });
            }
            return $http.get(
                thUrl.getProjectUrl("/resultset/", repoName),
                {
                    params: params,
                    // transformResponse:resultSetResponseTransformer
                }
            );
        },
        get: function(uri) {
            return $http.get(thServiceDomain + uri, {params: {format: "json"}});
        },
        getResultSetJobs: function(resultSets, repoName, exclusionProfile){

            _.each(
                resultSets.results,
                function(rs, index){
                    var params = {
                        result_set_id:rs.id,
                        full: "true",
                        count: 5000
                    };
                    if (exclusionProfile) {
                        params.exclusionProfile = exclusionProfile;
                    }
                    return ThJobModel.get_list(repoName, params).
                    then(function(jobList){
                        return groupJobByPlatform(jobList);
                    }).
                    then(function(response){
                        $rootScope.$emit(thEvents.mapResultSetJobs,
                            repoName, response
                        );
                    });
                }
            );
        }, //Close getResultSetJobs
        cancelAll: function(resultset_id, repoName) {
            var uri = resultset_id + '/cancel_all/';
            return $http.post(thUrl.getProjectUrl("/resultset/", repoName) + uri);
        }
    };
}]);
